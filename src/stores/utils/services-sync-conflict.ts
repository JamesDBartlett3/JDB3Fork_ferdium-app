import isEqual from 'lodash/isEqual';
import type Service from '../../models/Service';

// Only compare service fields that are part of persisted sync payloads.
// This keeps conflict detection stable across local-only runtime state.
//
// `updatedAt` is intentionally excluded: the Ferdium server does not return an
// `updatedAt` field for services (see ServiceController.list in
// ferdium/ferdium-server). It is only ever set locally, so comparing it would
// flag spurious conflicts (e.g. for newly created or pre-existing services
// whose timestamp never round-trips through the server). The actual service
// settings below round-trip reliably and already capture real divergence.
const toSyncComparableServices = (services: Service[] = []) => {
  return services
    .map(service => ({
      id: service.id,
      recipeId: service.recipe?.id,
      name: service.name,
      order: service.order,
      team: service.team,
      customUrl: service.customUrl,
      iconUrl: service.iconUrl,
      useFavicon: service.useFavicon,
      isEnabled: service.isEnabled,
      isNotificationEnabled: service.isNotificationEnabled,
      isBadgeEnabled: service.isBadgeEnabled,
      isMediaBadgeEnabled: service.isMediaBadgeEnabled,
      trapLinkClicks: service.trapLinkClicks,
      isIndirectMessageBadgeEnabled: service.isIndirectMessageBadgeEnabled,
      isMuted: service.isMuted,
      isDarkModeEnabled: service.isDarkModeEnabled,
      darkReaderSettings: service.darkReaderSettings,
      isProgressbarEnabled: service.isProgressbarEnabled,
      spellcheckerLanguage: service.spellcheckerLanguage,
      userAgentPref: service.userAgentPref,
      isHibernationEnabled: service.isHibernationEnabled,
      isWakeUpEnabled: service.isWakeUpEnabled,
      onlyShowFavoritesInUnreadCount: service.onlyShowFavoritesInUnreadCount,
      proxy: service.proxy,
      customIconUrl: service.customIconUrl,
      hasCustomUploadedIcon: service.hasCustomUploadedIcon,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
};

// Returns true when local and server service payloads diverge,
// independent of array order, based on sync-relevant fields.
export const hasServicesSyncConflict = (
  localServices: Service[] = [],
  serverServices: Service[] = [],
) =>
  !isEqual(
    toSyncComparableServices(localServices),
    toSyncComparableServices(serverServices),
  );
