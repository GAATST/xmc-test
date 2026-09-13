/**
 * XM Cloud Authoring API access via the Marketplace SDK proxy
 * (client.mutate("xmc.authoring.graphql", ...)) — runs as the logged-in
 * author; no tokens live in this app.
 *
 * NOTE (POC): field/argument names of the Authoring GraphQL schema
 * (item where-clause, FieldValueInput) should be verified against the target
 * environment on first run — the debug panel logs full responses to help.
 */
import type { MpClient } from './marketplace';

/** Sitecore field types the picker can write into. */
export const TARGET_FIELD_TYPES = ['Image', 'General Link'] as const;
export type TargetFieldType = (typeof TARGET_FIELD_TYPES)[number];

export interface TargetField {
  name: string;
  type: TargetFieldType;
  value: string;
}

export interface ItemInfo {
  itemId: string;
  name: string;
  path: string;
  targets: TargetField[];
}

const ITEM_FIELDS_SELECTION = `
      itemId
      name
      path
      fields(ownFields: true, excludeStandardFields: true) {
        nodes {
          name
          value
          templateField {
            type
          }
        }
      }
`;

const GET_ITEM_FIELDS_QUERY = `
  query DamPickerGetItemFields($itemId: ID!, $language: String!) {
    item(where: { database: "master", itemId: $itemId, language: $language }) {
${ITEM_FIELDS_SELECTION}
    }
  }
`;

const GET_ITEM_FIELDS_BY_PATH_QUERY = `
  query DamPickerGetItemFieldsByPath($path: String!, $language: String!) {
    item(where: { database: "master", path: $path, language: $language }) {
${ITEM_FIELDS_SELECTION}
    }
  }
`;

const GET_PAGE_LAYOUT_QUERY = `
  query DamPickerGetPageLayout($itemId: ID!, $language: String!) {
    item(where: { database: "master", itemId: $itemId, language: $language }) {
      itemId
      sharedLayout: field(name: "__Renderings") {
        value
      }
      finalLayout: field(name: "__Final Renderings") {
        value
      }
    }
  }
`;

const UPDATE_ITEM_FIELDS_MUTATION = `
  mutation DamPickerUpdateItem($itemId: ID!, $language: String!, $fields: [FieldValueInput!]!) {
    updateItem(
      input: { database: "master", itemId: $itemId, language: $language, fields: $fields }
    ) {
      item {
        itemId
      }
    }
  }
`;

interface GraphQLEnvelope {
  data?: unknown;
  errors?: { message: string }[];
}

async function executeAuthoringGraphQL(
  client: MpClient,
  sitecoreContextId: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const { data } = await client.mutate('xmc.authoring.graphql', {
    params: {
      query: { sitecoreContextId },
      body: { query, variables },
    },
  });

  // The SDK may return the GraphQL envelope directly or nested one level down.
  const envelope = (data ?? {}) as GraphQLEnvelope;
  if (envelope.errors?.length) {
    throw new Error(`Authoring API error: ${envelope.errors.map((e) => e.message).join('; ')}`);
  }
  return envelope.data ?? envelope;
}

interface RawFieldNode {
  name?: string;
  value?: string;
  templateField?: { type?: string };
}

/**
 * Reads a datasource item and returns its Image / General Link fields —
 * these become the "Apply to" dropdown (Option 2 target selection).
 * `ref` may be an item ID (GUID) or a Sitecore path — layout `ds` attributes
 * come in both shapes.
 */
export async function fetchItemTargets(
  client: MpClient,
  sitecoreContextId: string,
  ref: string,
  language: string
): Promise<ItemInfo> {
  const isPath = ref.startsWith('/');
  const result = (await executeAuthoringGraphQL(
    client,
    sitecoreContextId,
    isPath ? GET_ITEM_FIELDS_BY_PATH_QUERY : GET_ITEM_FIELDS_QUERY,
    isPath ? { path: ref, language } : { itemId: normalizeGuid(ref), language }
  )) as { item?: { itemId?: string; name?: string; path?: string; fields?: { nodes?: RawFieldNode[] } } };

  const item = result?.item;
  if (!item?.itemId) {
    throw new Error(`Item not found for '${ref}' (language: ${language})`);
  }

  const targets: TargetField[] = (item.fields?.nodes ?? [])
    .filter((node): node is Required<Pick<RawFieldNode, 'name'>> & RawFieldNode => {
      const type = node.templateField?.type;
      return Boolean(node.name) && (TARGET_FIELD_TYPES as readonly string[]).includes(type ?? '');
    })
    .map((node) => ({
      name: node.name as string,
      type: node.templateField?.type as TargetFieldType,
      value: node.value ?? '',
    }));

  return {
    itemId: item.itemId,
    name: item.name ?? '',
    path: item.path ?? '',
    targets,
  };
}

function normalizeGuid(ref: string): string {
  const bare = ref.replace(/[{}]/g, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bare)
    ? `{${bare.toUpperCase()}}`
    : ref;
}

/**
 * The Marketplace SDK does not expose WHICH component the author selected (a
 * known limitation), so the picker derives candidates from the page layout:
 * parse the `ds`/`s:ds` datasource references out of the page item's
 * __Renderings / __Final Renderings XML, load each referenced item, and keep
 * those that actually have Image / General Link fields. The page item itself
 * is included as a candidate when it has target fields.
 */
export async function fetchPageDatasourceCandidates(
  client: MpClient,
  sitecoreContextId: string,
  pageItemId: string,
  language: string
): Promise<ItemInfo[]> {
  const layoutResult = (await executeAuthoringGraphQL(
    client,
    sitecoreContextId,
    GET_PAGE_LAYOUT_QUERY,
    { itemId: normalizeGuid(pageItemId), language }
  )) as {
    item?: { itemId?: string; sharedLayout?: { value?: string }; finalLayout?: { value?: string } };
  };

  const layoutXml = `${layoutResult?.item?.sharedLayout?.value ?? ''}\n${
    layoutResult?.item?.finalLayout?.value ?? ''
  }`;

  const refs = new Set<string>();
  for (const match of layoutXml.matchAll(/\bs?:?ds="([^"]+)"/g)) {
    if (match[1]) {
      refs.add(match[1]);
    }
  }

  const candidates: ItemInfo[] = [];
  const seenItemIds = new Set<string>();

  // The page itself may carry Image/General Link fields too.
  const refsToScan = [pageItemId, ...refs];
  for (const ref of refsToScan.slice(0, 15)) {
    try {
      const info = await fetchItemTargets(client, sitecoreContextId, ref, language);
      if (info.targets.length > 0 && !seenItemIds.has(info.itemId)) {
        seenItemIds.add(info.itemId);
        candidates.push(info);
      }
    } catch {
      // Broken/foreign-language datasource reference — skip it.
    }
  }

  return candidates;
}

/** Writes one raw field value (image/link XML, or '' to clear) on the item. */
export async function updateItemField(
  client: MpClient,
  sitecoreContextId: string,
  itemId: string,
  language: string,
  fieldName: string,
  rawValue: string
): Promise<void> {
  await executeAuthoringGraphQL(client, sitecoreContextId, UPDATE_ITEM_FIELDS_MUTATION, {
    itemId: normalizeGuid(itemId),
    language,
    fields: [{ name: fieldName, value: rawValue }],
  });
}
