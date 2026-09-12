'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DamAsset, DamSearchResult } from 'lib/dam-picker/types';
import {
  detectOwningItem,
  extractItemContext,
  getApplicationContext,
  getMarketplaceClient,
  isEmbedded,
  type MpClient,
} from 'lib/dam-picker/marketplace';
import {
  fetchItemTargets,
  fetchPageDatasourceCandidates,
  updateItemField,
  type ItemInfo,
} from 'lib/dam-picker/authoring';
import { buildExternalLinkXml, buildImageFieldXml } from 'lib/dam-picker/fieldXml';
import { parseStore, serializeStore, type AssignmentMap } from 'lib/dam-picker/assignments';

type Mode = 'connecting' | 'connected' | 'standalone';
type ImageSize = 'thm' | 'pre' | 'scr';

interface StatusMessage {
  kind: 'error' | 'success';
  text: string;
}

const RESOURCE_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'document', label: 'Documents' },
];

/**
 * Access key delivered via the Deployment URL path: register the app as
 * https://<host>/dam-picker/k-<key> and Page Builder appends its routing
 * suffix after it. Falls back to a ?key= query param for direct/dev use.
 */
function readAccessKeyFromUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const segment = window.location.pathname.split('/').find((s) => s.startsWith('k-'));
  if (segment) {
    return segment.slice(2);
  }
  return new URLSearchParams(window.location.search).get('key') ?? '';
}

export default function DamPickerPage() {
  const [mode, setMode] = useState<Mode>('connecting');
  const [accessKey] = useState(readAccessKeyFromUrl);
  const [client, setClient] = useState<MpClient | null>(null);
  const [sitecoreContextId, setSitecoreContextId] = useState('');
  const [pagesContextRaw, setPagesContextRaw] = useState<unknown>(null);
  const [appContextRaw, setAppContextRaw] = useState<unknown>(null);

  // Page context (auto-detected from pages.context; manually correctable)
  const [itemId, setItemId] = useState(''); // page item ID
  const [language, setLanguage] = useState('en');

  // The datasource item that owns THIS custom field, resolved deterministically
  // via the nonce handshake (detectOwningItem). Null until resolved.
  const [boundItemId, setBoundItemId] = useState<string | null>(null);

  // Candidate components: normally just the bound item; the layout scan
  // ("Scan page") is a manual fallback when the handshake is unavailable.
  const [candidates, setCandidates] = useState<ItemInfo[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');

  // Custom field value: assignment map keyed by target field name
  const [assignments, setAssignments] = useState<AssignmentMap>({});

  // DAM search state
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceTypes, setResourceTypes] = useState('');
  const [searchResult, setSearchResult] = useState<DamSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Selection + apply state
  const [selected, setSelected] = useState<DamAsset | null>(null);
  const [targetField, setTargetField] = useState('');
  const [imageSize, setImageSize] = useState<ImageSize>('scr');
  const [altText, setAltText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // --- bootstrap -----------------------------------------------------------

  useEffect(() => {
    if (!isEmbedded()) {
      setMode('standalone');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const mpClient = await getMarketplaceClient();
        if (cancelled) return;
        setClient(mpClient);

        const storedValue = await mpClient.getValue().catch(() => undefined);
        if (cancelled) return;
        const store = parseStore(storedValue);
        setAssignments(store.fields);

        if (store.meta.boundItemId) {
          // Already bound on a previous open — no handshake needed.
          setBoundItemId(store.meta.boundItemId);
        } else {
          // Nonce handshake: write a probe into our own custom field and wait
          // for the fieldsUpdated event that echoes it — its itemId is the
          // datasource item this field lives on.
          const binding = await detectOwningItem(mpClient, (nonce) =>
            serializeStore({ meta: { ...store.meta, probe: nonce }, fields: store.fields })
          );
          if (cancelled) return;
          if (binding) {
            setBoundItemId(binding.itemId);
            if (binding.language) {
              setLanguage((prev) => (prev === 'en' ? binding.language! : prev));
            }
            // Persist the binding (and drop the transient probe).
            await mpClient
              .setValue(
                serializeStore({ meta: { boundItemId: binding.itemId }, fields: store.fields }),
                true
              )
              .catch(() => undefined);
          } else {
            setMessage({
              kind: 'error',
              text:
                'Could not auto-detect which component this field belongs to. ' +
                'Use "Scan page" below and pick the component manually.',
            });
          }
        }

        // Missing context id is a degraded state (no authoring write-back),
        // not a reason to fall back to standalone: search + custom-field
        // value still work.
        try {
          const appContext = await getApplicationContext(mpClient);
          if (cancelled) return;
          setAppContextRaw(appContext.raw);
          if (appContext.contextId) {
            setSitecoreContextId(appContext.contextId);
          } else {
            setMessage({
              kind: 'error',
              text:
                'No XM Cloud API access granted to this app — enable "Select APIs" in App Studio ' +
                '(Cloud Portal) to allow field write-back. Search still works.',
            });
          }
        } catch (contextError) {
          if (!cancelled) {
            setMessage({
              kind: 'error',
              text: `Could not read application.context (write-back disabled): ${errorText(contextError)}`,
            });
          }
        }

        // Subscribe so the debug panel always shows the live payload shape.
        await mpClient.query('pages.context', {
          subscribe: true,
          onSuccess: (ctx: unknown) => {
            if (cancelled) return;
            setPagesContextRaw(ctx);
            const extracted = extractItemContext(ctx);
            if (extracted.itemId) setItemId((prev) => prev || extracted.itemId!);
            if (extracted.language) setLanguage((prev) => (prev === 'en' ? extracted.language! : prev));
          },
        });

        setMode('connected');
      } catch (error) {
        if (!cancelled) {
          setMode('standalone');
          setMessage({
            kind: 'error',
            text: `Marketplace SDK init failed (running standalone): ${errorText(error)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- target fields -------------------------------------------------------

  const itemInfo = useMemo(
    () => candidates.find((c) => c.itemId === selectedItemId) ?? null,
    [candidates, selectedItemId]
  );

  const loadCandidates = useCallback(async () => {
    if (!client || !sitecoreContextId || !itemId) return;
    setBusy(true);
    setMessage(null);
    try {
      const found = await fetchPageDatasourceCandidates(client, sitecoreContextId, itemId, language);
      setCandidates(found);
      if (found.length === 0) {
        setSelectedItemId('');
        setMessage({
          kind: 'error',
          text: 'No components with Image or General Link fields found on this page.',
        });
      } else {
        setSelectedItemId((prev) => (found.some((c) => c.itemId === prev) ? prev : found[0].itemId));
      }
    } catch (error) {
      setCandidates([]);
      setMessage({ kind: 'error', text: `Could not scan the page for components: ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  }, [client, sitecoreContextId, itemId, language]);

  // Load the bound component's target fields (the normal, handshake-based path).
  useEffect(() => {
    if (mode !== 'connected' || !client || !sitecoreContextId || !boundItemId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setMessage(null);
      try {
        const info = await fetchItemTargets(client, sitecoreContextId, boundItemId, language);
        if (cancelled) return;
        setCandidates([info]);
        setSelectedItemId(info.itemId);
        if (info.targets.length === 0) {
          setMessage({
            kind: 'error',
            text: `Component "${info.name}" has no Image or General Link fields.`,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setMessage({
            kind: 'error',
            text: `Could not load component fields: ${errorText(error)}`,
          });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, client, sitecoreContextId, boundItemId, language]);

  // Keep the target-field selection valid for the currently selected component
  useEffect(() => {
    if (itemInfo && itemInfo.targets.length > 0) {
      setTargetField((prev) =>
        itemInfo.targets.some((t) => t.name === prev) ? prev : itemInfo.targets[0].name
      );
    }
  }, [itemInfo]);

  // --- DAM search ----------------------------------------------------------

  const runSearch = useCallback(async () => {
    setSearching(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        type: resourceTypes,
        limit: '24',
      });
      const response = await fetch(`/api/dam/search?${params.toString()}`, {
        headers: accessKey ? { 'x-dam-key': accessKey } : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      setSearchResult(body as DamSearchResult);
    } catch (error) {
      setSearchResult(null);
      setMessage({ kind: 'error', text: `DAM search failed: ${errorText(error)}` });
    } finally {
      setSearching(false);
    }
  }, [searchQuery, resourceTypes, accessKey]);

  // --- apply / clear -------------------------------------------------------

  const selectedTarget = useMemo(
    () => itemInfo?.targets.find((t) => t.name === targetField) ?? null,
    [itemInfo, targetField]
  );

  const persistAssignments = useCallback(
    async (next: AssignmentMap) => {
      setAssignments(next);
      if (client) {
        await client.setValue(
          serializeStore({ meta: { boundItemId: boundItemId ?? undefined }, fields: next }),
          true
        );
      }
    },
    [client, boundItemId]
  );

  const applyAssignment = useCallback(async () => {
    if (!client || !selected || !selectedTarget || !itemInfo) return;
    setBusy(true);
    setMessage(null);
    try {
      let url: string;
      let rawValue: string;

      if (selectedTarget.type === 'Image') {
        const sizeUrl = selected.urls[imageSize] ?? selected.urls.scr ?? selected.urls.pre;
        if (!sizeUrl) {
          throw new Error(`No '${imageSize}' preview URL available for this asset.`);
        }
        url = sizeUrl;
        // XM Cloud requires width/height on external images — compute the
        // delivered rendition's dimensions from the original ones.
        const SIZE_MAX: Record<ImageSize, number> = { thm: 150, pre: 600, scr: 1600 };
        let width = selected.width ?? SIZE_MAX[imageSize];
        let height = selected.height ?? SIZE_MAX[imageSize];
        if (imageSize === 'thm') {
          width = 150; // thm rendition is c_fill,w_150,h_150
          height = 150;
        } else if (width > SIZE_MAX[imageSize]) {
          height = Math.round((height * SIZE_MAX[imageSize]) / width);
          width = SIZE_MAX[imageSize];
        }
        rawValue = buildImageFieldXml({
          src: url,
          alt: altText || selected.title,
          width,
          height,
          thumbnailSrc: selected.urls.thm,
          stylelabsContentType: 'Image',
        });
      } else {
        // General Link: store the DAM's direct URL when the provider marks
        // originals as permanent (Cloudinary). Providers with expiring
        // download URLs (Fotoware-style) omit originalUrl, and the link falls
        // back to the /api/dam/file redirect route, which mints a fresh URL
        // per request.
        url =
          selected.originalUrl ??
          `/api/dam/file?id=${encodeURIComponent(selected.ref)}&rt=${selected.resourceType}&ext=${selected.extension}`;
        rawValue = buildExternalLinkXml({
          url,
          text: selected.title,
          title: selected.title,
          target: '_blank',
          stylelabsContentType: selected.extension || 'file',
        });
      }

      await updateItemField(
        client,
        sitecoreContextId,
        itemInfo.itemId,
        language,
        selectedTarget.name,
        rawValue
      );

      await persistAssignments({
        ...assignments,
        [selectedTarget.name]: {
          ref: selected.ref,
          url,
          title: selected.title,
          itemId: itemInfo.itemId,
          size: selectedTarget.type === 'Image' ? imageSize : undefined,
          extension: selected.extension,
          assignedAt: new Date().toISOString(),
        },
      });

      setMessage({
        kind: 'success',
        text: `Applied "${selected.title}" to ${selectedTarget.name}.`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: `Apply failed: ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  }, [
    client,
    selected,
    selectedTarget,
    itemInfo,
    language,
    sitecoreContextId,
    imageSize,
    altText,
    assignments,
    persistAssignments,
  ]);

  const clearAssignment = useCallback(
    async (fieldName: string) => {
      // Clear on the item the assignment was made on (falls back to the
      // currently selected component for legacy entries without itemId).
      const ownerItemId = assignments[fieldName]?.itemId ?? itemInfo?.itemId;
      if (!client || !ownerItemId) return;
      setBusy(true);
      setMessage(null);
      try {
        await updateItemField(client, sitecoreContextId, ownerItemId, language, fieldName, '');
        const next = { ...assignments };
        delete next[fieldName];
        await persistAssignments(next);
        setMessage({ kind: 'success', text: `Cleared ${fieldName}.` });
      } catch (error) {
        setMessage({ kind: 'error', text: `Clear failed: ${errorText(error)}` });
      } finally {
        setBusy(false);
      }
    },
    [client, itemInfo, language, sitecoreContextId, assignments, persistAssignments]
  );

  // --- render --------------------------------------------------------------

  const connected = mode === 'connected';
  const assignmentEntries = Object.entries(assignments);

  return (
    <div className="app">
      <div className="header">
        <h1>DAM Picker</h1>
        <span className={`badge badge-${mode}`}>
          {mode === 'connected' && 'Connected to Page Builder'}
          {mode === 'standalone' && 'Standalone (no Sitecore)'}
          {mode === 'connecting' && 'Connecting…'}
        </span>
      </div>

      {message && <div className={`message ${message.kind}`}>{message.text}</div>}

      {connected && (
        <div className="panel">
          <h2>Sitecore context</h2>
          <div className="row">
            <input
              type="text"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="Page item ID (auto-detected; paste to override)"
            />
            <input
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ maxWidth: 70, flex: 'none' }}
            />
            <button onClick={() => void loadCandidates()} disabled={busy || !itemId}>
              Scan page
            </button>
          </div>
          {candidates.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <label>Component:</label>
              <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.itemId} value={c.itemId}>
                    {c.name} — {c.targets.map((t) => t.name).join(', ')}
                  </option>
                ))}
              </select>
            </div>
          )}
          {itemInfo && <p className="muted">{itemInfo.path}</p>}
        </div>
      )}

      <div className="panel">
        <h2>Search the DAM</h2>
        <div className="row">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder="Search assets (empty = browse all)"
          />
          <select value={resourceTypes} onChange={(e) => setResourceTypes(e.target.value)}>
            {RESOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => void runSearch()} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {searchResult && (
          <>
            <p className="muted">{searchResult.total} result(s)</p>
            <div className="grid">
              {searchResult.assets.map((asset) => (
                <div
                  key={asset.ref}
                  className={`tile ${selected?.ref === asset.ref ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(asset);
                    setAltText(asset.title);
                  }}
                >
                  {asset.urls.thm ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.urls.thm} alt={asset.title} />
                  ) : (
                    <div className="tile-doc">📄</div>
                  )}
                  <div className="tile-title" title={asset.title}>
                    {asset.title}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="panel">
          <h2>Apply “{selected.title}”</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {selected.urls.pre && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="apply-preview" src={selected.urls.pre} alt={selected.title} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 220 }}>
              <div className="row">
                <label>Apply to:</label>
                <select
                  value={targetField}
                  onChange={(e) => setTargetField(e.target.value)}
                  disabled={!connected || !itemInfo}
                >
                  {(itemInfo?.targets ?? []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.type})
                    </option>
                  ))}
                </select>
              </div>
              {selectedTarget?.type === 'Image' && (
                <>
                  <div className="row">
                    <label>Size:</label>
                    <select value={imageSize} onChange={(e) => setImageSize(e.target.value as ImageSize)}>
                      <option value="scr">Screen (scr) — hero/large</option>
                      <option value="pre">Preview (pre) — medium</option>
                      <option value="thm">Thumbnail (thm) — small</option>
                    </select>
                  </div>
                  <div className="row">
                    <label>Alt text:</label>
                    <input type="text" value={altText} onChange={(e) => setAltText(e.target.value)} />
                  </div>
                </>
              )}
              {selectedTarget?.type === 'General Link' && (
                <p className="muted">
                  Link URL:{' '}
                  {selected.originalUrl ??
                    `/api/dam/file?id=${selected.ref}&rt=${selected.resourceType}&ext=${selected.extension} (redirect route — provider has expiring URLs)`}
                </p>
              )}
              <div className="row">
                <button
                  className="primary"
                  onClick={() => void applyAssignment()}
                  disabled={!connected || busy || !selectedTarget || !itemInfo || !sitecoreContextId}
                >
                  {busy ? 'Working…' : 'Apply to field'}
                </button>
                {!connected && <span className="muted">Sitecore writes disabled in standalone mode</span>}
                {connected && !sitecoreContextId && (
                  <span className="muted">Write-back disabled: no XM Cloud API access granted</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {assignmentEntries.length > 0 && (
        <div className="panel">
          <h2>Current assignments</h2>
          {assignmentEntries.map(([fieldName, assignment]) => (
            <div className="assignment" key={fieldName}>
              <div>
                <strong>{fieldName}</strong>: {assignment.title} (ref {assignment.ref}
                {assignment.size ? `, ${assignment.size}` : ''})
                <div className="meta">{assignment.url}</div>
              </div>
              <button
                className="danger"
                onClick={() => void clearAssignment(fieldName)}
                disabled={!connected || busy}
              >
                Clear
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panel debug">
        <button onClick={() => setDebugOpen((v) => !v)}>
          {debugOpen ? 'Hide' : 'Show'} debug info
        </button>
        {debugOpen && (
          <pre>
            {JSON.stringify(
              {
                mode,
                sitecoreContextId,
                itemId,
                language,
                boundItemId,
                selectedItemId,
                candidates,
                assignments,
                pagesContext: pagesContextRaw,
                appContext: appContextRaw,
              },
              null,
              2
            )}
          </pre>
        )}
      </div>

      {connected && (
        <div className="footer-actions">
          <button onClick={() => client?.closeApp()}>Done</button>
        </div>
      )}
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
