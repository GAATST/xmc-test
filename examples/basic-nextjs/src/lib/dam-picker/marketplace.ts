/**
 * Marketplace SDK bootstrap. The picker runs inside an iframe hosted by
 * Sitecore Page Builder; the SDK talks to the parent window via postMessage.
 * Outside Page Builder (window.self === window.top) the app runs in
 * "standalone" mode: DAM search works, Sitecore actions are disabled.
 */
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';

/**
 * The subset of the ClientSDK surface this app relies on, kept as a structural
 * type so minor SDK typing changes don't ripple through the codebase.
 */
export interface MpClient {
  query(key: string, options?: Record<string, unknown>): Promise<{ data?: unknown }>;
  mutate(key: string, options?: Record<string, unknown>): Promise<{ data?: unknown }>;
  subscribe?(
    key: string,
    handlers: { onData: (data: unknown) => void; onError?: (error: unknown) => void }
  ): (() => void) | undefined;
  getValue(): Promise<unknown>;
  setValue(value: string, commit?: boolean): Promise<unknown>;
  closeApp(): unknown;
}

export interface FieldsUpdatedEvent {
  itemId?: string;
  language?: string;
  fields?: { fieldId?: string; value?: string }[];
}

/**
 * Deterministically resolves WHICH item owns the custom field this app was
 * opened on. The SDK does not expose the selection, but setValue writes into
 * exactly that field — so we write a one-time nonce and wait for the
 * "pages.content.fieldsUpdated" event that echoes it back: its itemId is,
 * provably, the owning datasource item. Returns null if the event never
 * arrives (older SDK/host, or subscriptions unsupported).
 */
export function detectOwningItem(
  client: MpClient,
  probeValue: (nonce: string) => string,
  timeoutMs = 4000
): Promise<{ itemId: string; language?: string } | null> {
  return new Promise((resolve) => {
    if (typeof client.subscribe !== 'function') {
      resolve(null);
      return;
    }
    const nonce = `dam-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const finish = (result: { itemId: string; language?: string } | null) => {
      if (settled) return;
      settled = true;
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const unsubscribe = client.subscribe('pages.content.fieldsUpdated', {
      onData: (data) => {
        const event = data as FieldsUpdatedEvent;
        const echoed = event?.fields?.some(
          (f) => typeof f?.value === 'string' && f.value.includes(nonce)
        );
        if (echoed && event.itemId) {
          finish({ itemId: event.itemId, language: event.language });
        }
      },
      onError: () => finish(null),
    });

    void client.setValue(probeValue(nonce), true).catch(() => finish(null));
    setTimeout(() => finish(null), timeoutMs);
  });
}

let clientPromise: Promise<MpClient> | null = null;

export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.self !== window.top;
}

export function getMarketplaceClient(): Promise<MpClient> {
  if (!clientPromise) {
    clientPromise = ClientSDK.init({
      target: window.parent,
      modules: [XMC],
    }).then((client) => client as unknown as MpClient);
  }
  return clientPromise;
}

/**
 * The sitecoreContextId identifies the XM Cloud environment for xmc.* calls.
 * Taken from the app context's resource access grants (live, preview as
 * fallback). An empty resourceAccess usually means the app registration has
 * no APIs selected under "API access" in App Studio — a warning, not a reason
 * to disable the whole app (search and getValue/setValue still work).
 */
export async function getApplicationContext(
  client: MpClient
): Promise<{ contextId: string | null; raw: unknown }> {
  const { data } = await client.query('application.context');
  const context = (data as { resourceAccess?: { context?: { live?: string; preview?: string } }[] })
    ?.resourceAccess?.[0]?.context;
  return { contextId: context?.live || context?.preview || null, raw: data };
}

/**
 * Best-effort extraction of the current item context from pages.context.
 * The exact payload shape is a Phase-2 verification point — the debug panel
 * shows the raw object so the paths below can be corrected after the first
 * run inside Page Builder.
 */
export function extractItemContext(raw: unknown): { itemId?: string; language?: string } {
  const ctx = raw as Record<string, unknown> | undefined;
  const info = (ctx?.pageInfo ?? ctx) as Record<string, unknown> | undefined;
  const itemId = info?.id ?? info?.itemId ?? info?.pageId;
  const language = info?.language ?? info?.lang;
  return {
    itemId: typeof itemId === 'string' ? itemId : undefined,
    language: typeof language === 'string' ? language : undefined,
  };
}
