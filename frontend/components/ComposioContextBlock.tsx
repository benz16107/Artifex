"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  getComposioToolkits,
  postComposioConnect,
  postComposioDisconnect,
  postComposioDriveBrowse,
  postComposioFetch,
  type ComposioDriveBrowseItem,
  type ComposioToolkitInfo,
} from "@/lib/api";

type ComposioContextBlockProps = {
  disabled: boolean;
  onMergeDocumentSections: (sections: string[]) => void;
};

type FolderCrumb = { id: string; name: string };

function defaultExportMimeForDrive(mime: string): string {
  if (mime === "application/vnd.google-apps.document") return "text/plain";
  if (mime === "application/vnd.google-apps.spreadsheet") return "text/csv";
  if (mime === "application/vnd.google-apps.presentation") return "text/plain";
  return "";
}

export function ComposioContextBlock({ disabled, onMergeDocumentSections }: ComposioContextBlockProps) {
  const [enabled, setEnabled] = useState(false);
  const [toolkits, setToolkits] = useState<ComposioToolkitInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Server responded OK but Composio is not enabled (missing env on the Django process). */
  const [serverDisabledHint, setServerDisabledHint] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [fileId, setFileId] = useState("");
  const [mimeType, setMimeType] = useState("text/plain");
  const [pageId, setPageId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mergeHint, setMergeHint] = useState<string | null>(null);

  const driveDialogRef = useRef<HTMLDialogElement>(null);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([{ id: "root", name: "My Drive" }]);
  const [driveListMode, setDriveListMode] = useState<"browse" | "search">("browse");
  const [driveSearchDraft, setDriveSearchDraft] = useState("");
  const [driveItems, setDriveItems] = useState<ComposioDriveBrowseItem[]>([]);
  const [driveNextPage, setDriveNextPage] = useState<string | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [drivePickerError, setDrivePickerError] = useState<string | null>(null);

  const loadToolkits = useCallback(async () => {
    setLoadError(null);
    setServerDisabledHint(null);
    const data = await getComposioToolkits();
    if (!data.enabled) {
      setEnabled(false);
      setToolkits([]);
      setServerDisabledHint(
        "The backend reports Composio is off. Set COMPOSIO_API_KEY and COMPOSIO_ALLOWED_TOOLKITS for the Django process and restart the server. If you run the API in Docker, ensure those variables reach the container (for example env_file: .env on the backend service).",
      );
      return;
    }
    setEnabled(Boolean(data.enabled));
    const list = data.toolkits ?? [];
    setToolkits(list);
    setSelectedSlug((prev) => {
      if (list.some((t) => t.slug === prev)) return prev;
      return list[0]?.slug ?? "";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadToolkits()
      .then(() => {
        if (cancelled) return;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEnabled(false);
        setToolkits([]);
        setServerDisabledHint(null);
        setLoadError(err instanceof Error ? err.message : "Could not load Composio toolkits.");
      });
    return () => {
      cancelled = true;
    };
  }, [loadToolkits]);

  const selected = useMemo(
    () => toolkits.find((t) => t.slug === selectedSlug) ?? null,
    [toolkits, selectedSlug],
  );

  const closeDrivePicker = useCallback(() => {
    driveDialogRef.current?.close();
  }, []);

  const fetchDriveListing = useCallback(
    async (opts: {
      stack: FolderCrumb[];
      append: boolean;
      pageToken: string | null;
      mode: "browse" | "search";
      searchText?: string;
    }) => {
      const top = opts.stack[opts.stack.length - 1];
      if (!top) return;
      setDriveLoading(true);
      setDrivePickerError(null);
      try {
        const q = opts.mode === "search" ? (opts.searchText ?? "").trim() : "";
        const body =
          opts.mode === "search" && q
            ? {
                query: q,
                folder_id: top.id !== "root" ? top.id : null,
                page_token: opts.pageToken,
                page_size: 50,
              }
            : {
                folder_id: top.id,
                page_token: opts.pageToken,
                page_size: 50,
              };
        const data = await postComposioDriveBrowse(body);
        setDriveNextPage(data.next_page_token ?? null);
        setDriveItems((prev) => (opts.append ? [...prev, ...data.items] : data.items));
      } catch (e) {
        setDrivePickerError((e as Error).message);
      } finally {
        setDriveLoading(false);
      }
    },
    [],
  );

  const openDrivePicker = useCallback(() => {
    const rootStack: FolderCrumb[] = [{ id: "root", name: "My Drive" }];
    setFolderStack(rootStack);
    setDriveListMode("browse");
    setDriveSearchDraft("");
    setDriveItems([]);
    setDriveNextPage(null);
    setDrivePickerError(null);
    driveDialogRef.current?.showModal();
    void fetchDriveListing({
      stack: rootStack,
      append: false,
      pageToken: null,
      mode: "browse",
    });
  }, [fetchDriveListing]);

  const onDisconnect = useCallback(async () => {
    if (!selectedSlug || disabled || connecting || disconnecting || pulling) return;
    const label = selected?.name ?? selectedSlug;
    if (
      !window.confirm(
        `Remove the Composio connection for “${label}” for your user id? You can use Connect account again afterward.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setMergeHint(null);
    setDisconnecting(true);
    try {
      const r = await postComposioDisconnect({ toolkit: selectedSlug });
      await loadToolkits();
      setMergeHint(
        r.removed > 0
          ? `Disconnected ${r.removed} Composio connection${r.removed === 1 ? "" : "s"}. You can use Connect account again.`
          : "No Composio connections were found for this toolkit (it may already be disconnected).",
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }, [connecting, disabled, disconnecting, loadToolkits, pulling, selected?.name, selectedSlug]);

  const onConnect = useCallback(async () => {
    if (!selectedSlug || disabled || connecting || disconnecting || pulling) return;
    setActionError(null);
    setConnecting(true);
    try {
      const callback_url =
        typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : undefined;
      const { redirect_url } = await postComposioConnect({ toolkit: selectedSlug, callback_url });
      if (redirect_url) {
        window.location.href = redirect_url;
        return;
      }
      setActionError("No redirect URL returned from Composio.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [connecting, disabled, disconnecting, pulling, selectedSlug]);

  const onPull = useCallback(async () => {
    if (!selectedSlug || disabled || connecting || disconnecting || pulling) return;
    setActionError(null);
    setMergeHint(null);
    setPulling(true);
    try {
      const body: Parameters<typeof postComposioFetch>[0] = { toolkit: selectedSlug };
      if (selectedSlug === "googledrive") {
        body.file_id = fileId.trim();
        const mt = mimeType.trim();
        if (mt) body.mime_type = mt;
      } else if (selectedSlug === "notion") {
        body.page_id = pageId.trim();
      }
      const { sections } = await postComposioFetch(body);
      const cleaned = sections.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        setActionError("Composio returned no text sections.");
        return;
      }
      onMergeDocumentSections(cleaned);
      const n = cleaned.length;
      setMergeHint(
        n === 1 ? "Added 1 section from Composio to context documents." : `Added ${n} sections from Composio.`,
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPulling(false);
    }
  }, [connecting, disabled, disconnecting, fileId, mimeType, onMergeDocumentSections, pageId, pulling, selectedSlug]);

  const onDriveSearchSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const q = driveSearchDraft.trim();
      if (!q) {
        setDriveListMode("browse");
        void fetchDriveListing({
          stack: folderStack,
          append: false,
          pageToken: null,
          mode: "browse",
        });
        return;
      }
      setDriveListMode("search");
      setDriveItems([]);
      setDriveNextPage(null);
      void fetchDriveListing({
        stack: folderStack,
        append: false,
        pageToken: null,
        mode: "search",
        searchText: q,
      });
    },
    [driveSearchDraft, fetchDriveListing, folderStack],
  );

  const onDriveFolderEnter = useCallback(
    (item: ComposioDriveBrowseItem) => {
      if (!item.is_folder) return;
      const next = [...folderStack, { id: item.id, name: item.name }];
      setFolderStack(next);
      setDriveListMode("browse");
      setDriveSearchDraft("");
      void fetchDriveListing({
        stack: next,
        append: false,
        pageToken: null,
        mode: "browse",
      });
    },
    [fetchDriveListing, folderStack],
  );

  const onDriveFolderBack = useCallback(() => {
    if (folderStack.length <= 1) return;
    const next = folderStack.slice(0, -1);
    setFolderStack(next);
    setDriveListMode("browse");
    setDriveSearchDraft("");
    void fetchDriveListing({
      stack: next,
      append: false,
      pageToken: null,
      mode: "browse",
    });
  }, [fetchDriveListing, folderStack]);

  const onDrivePickFile = useCallback((item: ComposioDriveBrowseItem) => {
    if (item.is_folder) return;
    setFileId(item.id);
    const exp = defaultExportMimeForDrive(item.mime_type);
    setMimeType(exp || "text/plain");
    closeDrivePicker();
  }, [closeDrivePicker]);

  const driveBreadcrumb = useMemo(() => folderStack.map((c) => c.name).join(" › "), [folderStack]);

  if (loadError) {
    return (
      <details className="composioBlock">
        <summary>Connected sources (Composio)</summary>
        <p className="field__hint composioBlock__error" role="alert">
          {loadError} Check <code className="composioBlock__code">NEXT_PUBLIC_API_URL</code> matches your Django
          server, and that <code className="composioBlock__code">NEXT_PUBLIC_API_TOKEN</code> is set if the backend
          uses <code className="composioBlock__code">API_AUTH_TOKEN</code>.
        </p>
      </details>
    );
  }

  if (serverDisabledHint) {
    return (
      <details className="composioBlock">
        <summary>Connected sources (Composio)</summary>
        <p className="field__hint">{serverDisabledHint}</p>
      </details>
    );
  }

  if (!enabled || toolkits.length === 0) {
    return null;
  }

  const blocked = disabled || connecting || disconnecting || pulling;
  const needsDrive = selectedSlug === "googledrive";
  const needsNotion = selectedSlug === "notion";
  const canPull =
    (needsDrive && fileId.trim().length > 0) || (needsNotion && pageId.trim().length > 0);

  return (
    <details className="composioBlock">
      <summary>Connected sources (Composio)</summary>
      <p className="field__hint">
        Pull text from an allowed integration. Use a stable user id (header <code className="composioBlock__code">x-user-id</code>
        ) so connections persist.
      </p>
      <div className="field">
        <label className="field__label" htmlFor="composio-toolkit">
          Toolkit
        </label>
        <select
          id="composio-toolkit"
          className="input"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          disabled={blocked}
        >
          {toolkits.map((tk) => (
            <option key={tk.slug} value={tk.slug}>
              {tk.name}
              {tk.connected ? " — connected" : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="field__hint">
        Status: {selected?.connected ? <strong>connected</strong> : <strong>not connected</strong>}
        {selected?.connected ? null : (
          <span> (may be stale; if Connect says you are already linked, pick a Drive file below and use Pull.)</span>
        )}
      </p>
      {selected?.warning ? (
        <p className="field__hint composioBlock__error" role="status">
          {selected.warning}
        </p>
      ) : null}
      {needsDrive ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="composio-file-id">
              Drive file <span className="field__req">required</span>
            </label>
            <div className="composioDrivePickRow">
              <input
                id="composio-file-id"
                className="input composioDrivePickRow__input"
                placeholder="Pick from Drive or paste a link / id"
                value={fileId}
                onChange={(e) => setFileId(e.target.value)}
                disabled={blocked}
                autoComplete="off"
              />
              <button
                type="button"
                className="button button--ghost composioDrivePickRow__btn"
                onClick={openDrivePicker}
                disabled={blocked}
              >
                Browse Drive
              </button>
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="composio-mime">
              Export MIME (Google Docs / Sheets) <span className="field__optional">optional</span>
            </label>
            <input
              id="composio-mime"
              className="input"
              placeholder="text/plain"
              value={mimeType}
              onChange={(e) => setMimeType(e.target.value)}
              disabled={blocked}
              autoComplete="off"
            />
          </div>
          <dialog ref={driveDialogRef} className="composioDrivePicker" aria-labelledby="composio-drive-picker-title">
            <div className="composioDrivePicker__inner">
              <div className="composioDrivePicker__head">
                <h2 id="composio-drive-picker-title" className="composioDrivePicker__title">
                  Choose a Google Drive file
                </h2>
                <button type="button" className="button button--ghost composioDrivePicker__close" onClick={closeDrivePicker}>
                  Close
                </button>
              </div>
              <p className="field__hint composioDrivePicker__crumb">{driveBreadcrumb}</p>
              <form className="composioDrivePicker__search" onSubmit={onDriveSearchSubmit}>
                <input
                  className="input"
                  placeholder="Search Drive (name or content)…"
                  value={driveSearchDraft}
                  onChange={(e) => setDriveSearchDraft(e.target.value)}
                  disabled={driveLoading}
                  autoComplete="off"
                />
                <button type="submit" className="button button--ghost" disabled={driveLoading}>
                  Search
                </button>
                {driveListMode === "search" ? (
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={driveLoading}
                    onClick={() => {
                      setDriveListMode("browse");
                      setDriveSearchDraft("");
                      void fetchDriveListing({
                        stack: folderStack,
                        append: false,
                        pageToken: null,
                        mode: "browse",
                      });
                    }}
                  >
                    Clear search
                  </button>
                ) : null}
              </form>
              <div className="composioDrivePicker__toolbar">
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={driveLoading || folderStack.length <= 1}
                  onClick={onDriveFolderBack}
                >
                  Up
                </button>
                {driveLoading ? <span className="composioDrivePicker__loading">Loading…</span> : null}
              </div>
              {drivePickerError ? (
                <p className="field__hint composioBlock__error" role="alert">
                  {drivePickerError}
                </p>
              ) : null}
              <ul className="composioDrivePicker__list" role="listbox" aria-label="Drive files">
                {driveItems.length === 0 && !driveLoading ? (
                  <li className="composioDrivePicker__empty">No files here. Try another folder or Search.</li>
                ) : null}
                {driveItems.map((item) => (
                  <li key={item.id} className="composioDrivePicker__row">
                    {item.is_folder ? (
                      <button type="button" className="composioDrivePicker__link" onClick={() => onDriveFolderEnter(item)}>
                        <span className="composioDrivePicker__kind">Folder</span>
                        {item.name}
                      </button>
                    ) : (
                      <button type="button" className="composioDrivePicker__link" onClick={() => onDrivePickFile(item)}>
                        <span className="composioDrivePicker__kind">File</span>
                        {item.name}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {driveNextPage ? (
                <div className="composioDrivePicker__more">
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={driveLoading}
                    onClick={() => {
                      const mode = driveListMode;
                      const searchText = driveSearchDraft.trim();
                      void fetchDriveListing({
                        stack: folderStack,
                        append: true,
                        pageToken: driveNextPage,
                        mode: mode === "search" && searchText ? "search" : "browse",
                        searchText: mode === "search" ? searchText : undefined,
                      });
                    }}
                  >
                    Load more
                  </button>
                </div>
              ) : null}
            </div>
          </dialog>
        </>
      ) : null}
      {needsNotion ? (
        <div className="field">
          <label className="field__label" htmlFor="composio-page-id">
            Notion page ID <span className="field__req">required</span>
          </label>
          <input
            id="composio-page-id"
            className="input"
            placeholder="UUID from the page URL"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            disabled={blocked}
            autoComplete="off"
          />
        </div>
      ) : null}
      <div className="composioBlock__actions">
        <button type="button" className="button button--ghost" onClick={onConnect} disabled={blocked || !selectedSlug}>
          {connecting ? "Opening…" : "Connect account"}
        </button>
        <button type="button" className="button button--ghost" onClick={onDisconnect} disabled={blocked || !selectedSlug}>
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
        <button type="button" className="button button--ghost" onClick={onPull} disabled={blocked || !canPull}>
          {pulling ? "Pulling…" : "Pull into context"}
        </button>
      </div>
      {actionError ? (
        <p className="field__hint composioBlock__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {mergeHint ? <p className="field__hint">{mergeHint}</p> : null}
    </details>
  );
}
