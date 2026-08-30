import { readJson } from 'fs-extra';
import { type IReactionDisposer, autorun } from 'mobx';
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';

import type { Params } from 'react-router-dom';
import type { StoresProps } from '../../@types/ferdium-components.types';
import RecipesDashboard from '../../components/settings/recipes/RecipesDashboard';
import { H1 } from '../../components/ui/headline';
import Infobox from '../../components/ui/infobox/index';
import ErrorBoundary from '../../components/util/ErrorBoundary';
import withParams from '../../components/util/WithParams';
import {
  CUSTOM_WEBSITE_RECIPE_ID,
  FERDIUM_DEV_DOCS,
  LOCAL_SERVER,
} from '../../config';
import { userDataRecipesPath } from '../../environment-remote';
import { communityRecipesStore } from '../../features/communityRecipes';
import { asarRecipesPath } from '../../helpers/asar-helpers';
import { openPath } from '../../helpers/url-helpers';
import type Recipe from '../../models/Recipe';
import RecipePreview from '../../models/RecipePreview';

interface IProps extends Partial<StoresProps>, WrappedComponentProps {
  params: Params;
}

const messages = defineMessages({
  headline: {
    id: 'settings.recipes.headline',
    defaultMessage: 'Available services',
  },
  offline: {
    id: 'settings.recipes.offline',
    defaultMessage:
      "Can't add new services while the Ferdium server is offline. Please try again when the connection is restored.",
  },
  connecting: {
    id: 'settings.recipes.connecting',
    defaultMessage: 'Connecting to server...',
  },
});

interface IState {
  needle: string | null;
  currentFilter: string;
}

@inject('stores', 'actions')
@observer
class RecipesScreen extends Component<IProps, IState> {
  autorunDisposer: IReactionDisposer | null = null;

  customRecipes: Recipe[] = [];

  constructor(props: IProps) {
    super(props);

    this.state = {
      needle: null,
      currentFilter: 'featured',
    };
  }

  componentDidMount(): void {
    // Load custom recipes asynchronously to prevent blocking the UI
    readJson(asarRecipesPath('all.json'))
      .then(recipes => {
        this.customRecipes = recipes;
        // Trigger a re-render if we're on the 'all' filter and recipes were loaded
        if (this.state.currentFilter === 'all') {
          this.forceUpdate();
        }
      })
      .catch(error => {
        console.error('Failed to load custom recipes:', error);
        this.customRecipes = [];
      });

    this.autorunDisposer = autorun(() => {
      const { filter } = this.props.params;
      const { currentFilter } = this.state;

      if (filter === 'all' && currentFilter !== 'all') {
        this.setState({ currentFilter: 'all' });
      } else if (filter === 'featured' && currentFilter !== 'featured') {
        this.setState({ currentFilter: 'featured' });
      } else if (filter === 'dev' && currentFilter !== 'dev') {
        this.setState({ currentFilter: 'dev' });
      }
    });
  }

  componentWillUnmount(): void {
    this.props.stores!.services.resetStatus();

    if (typeof this.autorunDisposer === 'function') {
      this.autorunDisposer();
    }
  }

  searchRecipes(needle: string | null): void {
    if (needle === '') {
      this.resetSearch();
    } else {
      const { search } = this.props.actions!.recipePreview;
      this.setState({ needle });
      search({ needle });
    }
  }

  _sortByName(recipe1, recipe2): number {
    if (recipe1.name.toLowerCase() < recipe2.name.toLowerCase()) {
      return -1;
    }
    if (recipe1.name.toLowerCase() > recipe2.name.toLowerCase()) {
      return 1;
    }
    return 0;
  }

  prepareRecipes(recipes: RecipePreview[]): RecipePreview[] {
    return (
      recipes
        // Filter out duplicate recipes
        .filter((recipe, index, self) => {
          const ids = self.map(rec => rec.id);
          return ids.indexOf(recipe.id) === index;

          // Sort alphabetically
        })
        .sort(this._sortByName)
    );
  }

  // Create an array of RecipePreviews from an array of recipe objects
  createPreviews(recipes: Recipe[]) {
    return recipes.map((recipe: any) => new RecipePreview(recipe));
  }

  resetSearch(): void {
    this.setState({ needle: null, currentFilter: 'featured' });
  }

  render(): ReactElement {
    const { recipePreviews, recipes, services, requests, settings } =
      this.props.stores!;
    const { app: appActions, service: serviceActions } = this.props.actions!;
    const filter = this.state.currentFilter;

    let recipeFilter;

    if (filter === 'all') {
      recipeFilter = this.prepareRecipes([
        ...recipePreviews.all,
        ...this.createPreviews(this.customRecipes),
      ]);
    } else if (filter === 'dev') {
      recipeFilter = communityRecipesStore.communityRecipes;
    } else {
      recipeFilter = recipePreviews.featured;
    }
    recipeFilter = [...recipeFilter].sort(this._sortByName);

    const { needle } = this.state;
    const allRecipes =
      needle === null
        ? recipeFilter
        : this.prepareRecipes([
            // All search recipes from server
            ...recipePreviews.searchResults,
            // All search recipes from local recipes
            ...this.createPreviews(
              this.customRecipes.filter(
                (recipe: Recipe) =>
                  recipe.name.toLowerCase().includes(needle.toLowerCase()) ||
                  (recipe.aliases || []).some(alias =>
                    alias.toLowerCase().includes(needle.toLowerCase()),
                  ),
              ),
            ),
          ]).sort(this._sortByName);

    const customWebsiteRecipe = recipePreviews.all.find(
      service => service.id === CUSTOM_WEBSITE_RECIPE_ID,
    );

    const isLoading =
      recipePreviews.featuredRecipePreviewsRequest.isExecuting ||
      recipePreviews.allRecipePreviewsRequest.isExecuting ||
      recipes.installRecipeRequest.isExecuting ||
      recipePreviews.searchRecipePreviewsRequest.isExecuting;

    const recipeDirectory = userDataRecipesPath('dev');

    // Determine if this is a remote-synced account
    const isRemoteAccount = settings.all.app.server !== LOCAL_SERVER;

    // For remote accounts that are offline, show offline warning
    if (isRemoteAccount && requests.serverConnection === 'disconnected') {
      return (
        <ErrorBoundary>
          <div className="settings__main">
            <div className="settings__header">
              <H1>{this.props.intl.formatMessage(messages.headline)}</H1>
            </div>
            <div className="settings__body">
              <Infobox type="warning" icon="alert-circle-outline">
                {this.props.intl.formatMessage(messages.offline)}
              </Infobox>
            </div>
          </div>
        </ErrorBoundary>
      );
    }

    // Server is connected or this is a local-only account — show recipes normally
    return (
      <ErrorBoundary>
        <RecipesDashboard
          recipes={allRecipes}
          customWebsiteRecipe={customWebsiteRecipe}
          isLoading={isLoading}
          hasLoadedRecipes={
            recipePreviews.featuredRecipePreviewsRequest.wasExecuted
          }
          showAddServiceInterface={serviceActions.showAddServiceInterface}
          searchRecipes={e => this.searchRecipes(e)}
          resetSearch={() => this.resetSearch()}
          searchNeedle={this.state.needle}
          serviceStatus={services.actionStatus}
          recipeFilter={filter}
          recipeDirectory={recipeDirectory}
          openRecipeDirectory={() => openPath(recipeDirectory)}
          openDevDocs={() =>
            appActions.openExternalUrl({ url: FERDIUM_DEV_DOCS })
          }
          isServerReachable={requests.serverConnection === 'connected'}
          hasPendingSyncConflict={services.hasPendingSyncConflict}
        />
      </ErrorBoundary>
    );
  }
}

export default withParams(injectIntl(RecipesScreen));
