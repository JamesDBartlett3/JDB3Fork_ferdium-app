import { hasServicesSyncConflict } from '../../../src/stores/utils/services-sync-conflict';

const createService = (overrides = {}) =>
  ({
    id: 'service-1',
    recipe: { id: 'slack' },
    name: 'Slack',
    order: 0,
    team: '',
    customUrl: '',
    iconUrl: '',
    useFavicon: false,
    isEnabled: true,
    isNotificationEnabled: true,
    isBadgeEnabled: true,
    isMediaBadgeEnabled: true,
    trapLinkClicks: true,
    isIndirectMessageBadgeEnabled: true,
    isMuted: false,
    isDarkModeEnabled: false,
    darkReaderSettings: { brightness: 100, contrast: 90, sepia: 10 },
    isProgressbarEnabled: true,
    spellcheckerLanguage: null,
    userAgentPref: '',
    isHibernationEnabled: false,
    isWakeUpEnabled: true,
    onlyShowFavoritesInUnreadCount: false,
    proxy: null,
    customIconUrl: '',
    hasCustomUploadedIcon: false,
    ...overrides,
  }) as any;

describe('hasServicesSyncConflict', () => {
  it('returns false for empty inputs', () => {
    expect(hasServicesSyncConflict([], [])).toBe(false);
    expect(hasServicesSyncConflict(undefined as any, undefined as any)).toBe(
      false,
    );
  });

  it('returns false when services are equivalent in different order', () => {
    const local = [createService({ id: 'a' }), createService({ id: 'b' })];
    const remote = [createService({ id: 'b' }), createService({ id: 'a' })];

    expect(hasServicesSyncConflict(local, remote)).toBe(false);
  });

  it('returns true when a saved order property differs', () => {
    // Response-array order is ignored, but each service's persisted `order`
    // value is meaningful and a difference in it remains a conflict.
    const local = [createService({ id: 'a', order: 0 })];
    const remote = [createService({ id: 'a', order: 1 })];

    expect(hasServicesSyncConflict(local, remote)).toBe(true);
  });

  it('returns true when a service setting differs', () => {
    const local = [createService({ isMuted: false })];
    const remote = [createService({ isMuted: true })];

    expect(hasServicesSyncConflict(local, remote)).toBe(true);
  });

  it('ignores updatedAt-only differences (server never returns updatedAt)', () => {
    const local = [createService({ updatedAt: 1000 })];
    const remote = [createService({ updatedAt: 2000 })];

    expect(hasServicesSyncConflict(local, remote)).toBe(false);
  });

  it('returns true when services length differs', () => {
    const local = [createService({ id: 'a' })];
    const remote = [createService({ id: 'a' }), createService({ id: 'b' })];

    expect(hasServicesSyncConflict(local, remote)).toBe(true);
  });

  it('returns true when service ids differ', () => {
    const local = [createService({ id: 'a' })];
    const remote = [createService({ id: 'b' })];

    expect(hasServicesSyncConflict(local, remote)).toBe(true);
  });
});
