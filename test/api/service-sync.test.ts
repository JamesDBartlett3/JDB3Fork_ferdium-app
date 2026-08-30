import {
  SERVER_OWNED_SERVICE_FIELDS,
  applyServerOwnedFields,
} from '../../src/api/server/service-sync';
import type ServiceModel from '../../src/models/Service';

// applyServerOwnedFields is a pure function over the raw server payload and
// the target service object, so plain stub objects suffice — no Service
// model instantiation needed.
const createTarget = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'service-1',
    name: 'Local name',
    team: 'local-team',
    order: 3,
    proxy: 'http://local-proxy:8080',
    isMuted: true,
    isEnabled: true,
    // client-only runtime state
    webview: { id: 'wv-1' },
    isAttached: true,
    unreadDirectMessageCount: 5,
    ...overrides,
  }) as unknown as ServiceModel;

describe('applyServerOwnedFields', () => {
  it('applies a present property even when the value is null', () => {
    const target = createTarget({ proxy: 'http://local-proxy:8080' });

    applyServerOwnedFields(target, {
      id: 'service-1',
      recipeId: 'slack',
      proxy: null,
    });

    expect((target as any).proxy).toBeNull();
  });

  it('applies explicit false, 0 and empty-string values', () => {
    const target = createTarget({
      isMuted: true,
      order: 3,
      team: 'local-team',
    });

    applyServerOwnedFields(target, {
      id: 'service-1',
      recipeId: 'slack',
      isMuted: false,
      order: 0,
      team: '',
    });

    expect((target as any).isMuted).toBe(false);
    expect((target as any).order).toBe(0);
    expect((target as any).team).toBe('');
  });

  it('keeps a missing optional property distinguishable from an explicit null', () => {
    const withAbsent = createTarget({ proxy: 'http://local-proxy:8080' });
    const withNull = createTarget({ proxy: 'http://local-proxy:8080' });

    applyServerOwnedFields(withAbsent, { id: 'service-1', recipeId: 'slack' });
    applyServerOwnedFields(withNull, {
      id: 'service-1',
      recipeId: 'slack',
      proxy: null,
    });

    // Absent: existing local value preserved (policy: preserve).
    expect((withAbsent as any).proxy).toBe('http://local-proxy:8080');
    // Explicit null: applied verbatim.
    expect((withNull as any).proxy).toBeNull();
  });

  it('never touches client-only runtime state, even if present in the payload', () => {
    const target = createTarget();

    applyServerOwnedFields(target, {
      id: 'service-1',
      recipeId: 'slack',
      name: 'Server name',
      // The server never sends these, but even a hostile payload must not
      // overwrite runtime state.
      webview: null,
      isAttached: false,
      unreadDirectMessageCount: 0,
      isLoading: false,
    } as any);

    expect((target as any).name).toBe('Server name');
    expect((target as any).webview).toEqual({ id: 'wv-1' });
    expect((target as any).isAttached).toBe(true);
    expect((target as any).unreadDirectMessageCount).toBe(5);
  });

  it('ignores response fields that are not server-owned (e.g. userId)', () => {
    const target = createTarget();

    applyServerOwnedFields(target, {
      id: 'service-1',
      recipeId: 'slack',
      userId: 42,
      customRecipe: false,
    } as any);

    expect((target as any).userId).toBeUndefined();
    expect((target as any).customRecipe).toBeUndefined();
  });

  it('only considers fields listed in SERVER_OWNED_SERVICE_FIELDS', () => {
    // Guard against silently dropping the explicit-list policy: the list must
    // contain the known server-owned settings.
    for (const field of [
      'name',
      'order',
      'team',
      'customUrl',
      'isEnabled',
      'isMuted',
      'isDarkModeEnabled',
      'isHibernationEnabled',
      'proxy',
      'userAgentPref',
    ]) {
      expect(SERVER_OWNED_SERVICE_FIELDS).toContain(field);
    }
    // Identity fields are handled separately, not via the field policy.
    expect(SERVER_OWNED_SERVICE_FIELDS).not.toContain('id');
    expect(SERVER_OWNED_SERVICE_FIELDS).not.toContain('recipeId');
    // Local metadata is not server-owned.
    expect(SERVER_OWNED_SERVICE_FIELDS).not.toContain('updatedAt');
  });
});
