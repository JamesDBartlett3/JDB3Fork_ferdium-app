import type ServiceModel from '../../models/Service';

/**
 * Types and field policy for synchronizing services from the Ferdium server.
 *
 * The boundary defined here separates the *raw* server payload (exactly as
 * returned by `GET /me/services`) from the constructed `Service` models. The
 * raw payload must be preserved so that a missing property remains
 * distinguishable from an explicit `null` / `false` / `0` / `''` value — the
 * `Service` constructor would otherwise erase that difference with defaults.
 */

/**
 * A single service entry exactly as received from `GET /me/services`.
 * The server spreads a per-service `settings` blob and then overrides
 * `iconUrl`, `id`, `name`, `recipeId` and `userId`. It never returns
 * `updatedAt` for services.
 */
export interface RawServiceResponse {
  id: string;
  recipeId: string;
  [key: string]: unknown;
}

/** A raw server response paired with its constructed `Service` model. */
export interface PreparedServiceSyncEntry {
  raw: RawServiceResponse;
  model: ServiceModel;
}

/** The complete synchronization result produced by the server fetch. */
export interface ServiceSyncResult {
  entries: PreparedServiceSyncEntry[];
}

/**
 * Server-owned persisted settings that participate in synchronization.
 *
 * When the raw response *contains* one of these properties, its value is
 * applied to the existing service object even when the value is `null`,
 * `false`, `0` or an empty string. When the property is *absent*, the policy
 * below decides between a known client default (only where current server
 * behavior clearly defines omission as that default) and preserving the
 * existing local value.
 *
 * Identity fields (`id`, `recipeId`) are handled separately: a matching `id`
 * and `recipeId` is the condition for safe in-place reuse of the object.
 *
 * Client-only runtime state (webview references, attachment/loading/crash
 * state, unread counts, polling state, media state, etc.) is never part of
 * this list and is therefore never overwritten by an accepted server payload.
 */
export const SERVER_OWNED_SERVICE_FIELDS = [
  'name',
  'order',
  'team',
  'customUrl',
  'iconUrl',
  'useFavicon',
  'isEnabled',
  'isNotificationEnabled',
  'isBadgeEnabled',
  'isMediaBadgeEnabled',
  'trapLinkClicks',
  'isIndirectMessageBadgeEnabled',
  'isMuted',
  'isDarkModeEnabled',
  'darkReaderSettings',
  'isProgressbarEnabled',
  'spellcheckerLanguage',
  'userAgentPref',
  'isHibernationEnabled',
  'isWakeUpEnabled',
  'onlyShowFavoritesInUnreadCount',
  'proxy',
  'customIconUrl',
  'hasCustomUploadedIcon',
] as const;

export type ServerOwnedServiceField =
  (typeof SERVER_OWNED_SERVICE_FIELDS)[number];

/**
 * Policy for a server-owned property that is *absent* from the raw response.
 *
 * - `preserve`: keep the existing local value (default — the server has told
 *   us nothing about this field, so we must not invent a value).
 * - `default`: apply a known client default. Only use this where current
 *   server behavior clearly defines omission as that default.
 */
export type AbsentFieldPolicy = 'preserve' | 'default';

/**
 * Documented per-field policy for absent properties. Any field not listed
 * here defaults to `preserve`.
 */
export const ABSENT_FIELD_POLICY: Partial<
  Record<ServerOwnedServiceField, AbsentFieldPolicy>
> = {
  // Currently every server-owned field defaults to `preserve` when absent:
  // the Ferdium server always spreads the stored settings blob, so a missing
  // key means "unknown", not "reset to default". Individual fields can be
  // promoted to `'default'` here if server behavior is verified to define
  // omission as a specific default.
};

/**
 * Apply accepted server-owned properties from a raw response onto an existing
 * service object in place. Only fields listed in `SERVER_OWNED_SERVICE_FIELDS`
 * are considered; properties present in the raw response are applied verbatim
 * (including `null`, `false`, `0` and `''`), absent properties follow
 * `ABSENT_FIELD_POLICY` (default: preserve the existing local value).
 *
 * Client-only runtime state is never touched, so webview references, event
 * handlers, loading state, unread counts, crash state, etc. stay attached to
 * the same object.
 */
export function applyServerOwnedFields(
  target: ServiceModel,
  raw: RawServiceResponse,
): void {
  const writable = target as unknown as Record<string, unknown>;
  for (const field of SERVER_OWNED_SERVICE_FIELDS) {
    if (Object.hasOwn(raw, field)) {
      // Present in the raw response: apply the value even when it is
      // null / false / 0 / ''.
      writable[field] = raw[field];
    } else if (ABSENT_FIELD_POLICY[field] === 'default') {
      // Reserved for fields whose omission the server clearly defines as a
      // known default. No field currently uses this policy.
      writable[field] = undefined;
    }
    // Otherwise: preserve the existing local value.
  }
}
