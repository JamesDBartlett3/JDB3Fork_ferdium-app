// Mirrors the response shape of the Ferdium server `GET /me/services`
// endpoint, as implemented by `ServiceController.list` in
// https://github.com/ferdium/ferdium-server
// (app/Controllers/Http/ServiceController.ts).
//
// The server always returns these top-level fields, then spreads the
// per-service `settings` blob, and finally overrides `iconUrl`, `id`,
// `name`, `recipeId` and `userId`. Importantly, the server does NOT return
// an `updatedAt` field for services.
export interface ServerServiceFixtureOverrides {
  [key: string]: unknown;
}

export const createServerService = (
  overrides: ServerServiceFixtureOverrides = {},
) => ({
  customRecipe: false,
  hasCustomIcon: false,
  isBadgeEnabled: true,
  isDarkModeEnabled: '',
  isEnabled: true,
  isMuted: false,
  isNotificationEnabled: true,
  order: 1,
  spellcheckerLanguage: '',
  workspaces: [],
  iconUrl: null,
  id: 'service-1',
  name: 'Slack',
  recipeId: 'slack',
  userId: 1,
  ...overrides,
});
