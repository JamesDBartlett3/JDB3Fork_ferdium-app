import type Service from '../../models/Service';
import isEqual from 'lodash/isEqual';

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

export const hasServicesSyncConflict = (
  localServices: Service[] = [],
  serverServices: Service[] = [],
) =>
  !isEqual(
    toSyncComparableServices(localServices),
    toSyncComparableServices(serverServices),
  );
