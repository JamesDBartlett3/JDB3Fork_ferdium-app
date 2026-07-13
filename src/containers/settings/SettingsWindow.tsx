import { inject, observer } from 'mobx-react';
import { Component, type ReactElement, type ReactPortal } from 'react';
import ReactDOM from 'react-dom';
import { Outlet } from 'react-router-dom';
import type { StoresProps } from '../../@types/ferdium-components.types';
import { LOCAL_SERVER } from '../../config';
import Layout from '../../components/settings/SettingsLayout';
import Navigation from '../../components/settings/navigation/SettingsNavigation';
import ErrorBoundary from '../../components/util/ErrorBoundary';
import { workspaceStore } from '../../features/workspaces';

interface IProps extends Partial<StoresProps> {}

@inject('stores', 'actions')
@observer
class SettingsContainer extends Component<IProps> {
  portalRoot: HTMLElement | null;

  el: HTMLDivElement;

  previousPathname: string = '';

  constructor(props: IProps) {
    super(props);

    this.portalRoot = document.querySelector('#portalContainer');
    this.el = document.createElement('div');
  }

  componentDidMount(): void {
    if (this.portalRoot) {
      this.portalRoot.append(this.el);
    }

    const { stores } = this.props;
    const isRemoteAccount =
      stores && stores.settings.all.app.server !== LOCAL_SERVER;

    // Sync services immediately when settings modal opens
    if (isRemoteAccount) {
      stores!.services.syncFromServer();
    }

    // Track current pathname to detect changes
    this.previousPathname = stores!.router.location.pathname;
  }

  componentDidUpdate(): void {
    const { stores } = this.props;
    const currentPathname = stores!.router.location.pathname;
    const isRemoteAccount =
      stores && stores.settings.all.app.server !== LOCAL_SERVER;

    // Sync whenever pathname changes and we're in settings
    if (
      isRemoteAccount &&
      currentPathname !== this.previousPathname &&
      currentPathname.startsWith('/settings')
    ) {
      stores!.services.syncFromServer();
      this.previousPathname = currentPathname;
    }
  }

  componentWillUnmount(): void {
    this.el.remove();
  }

  render(): ReactPortal {
    const { stores } = this.props;
    const { closeSettings } = this.props.actions!.ui;

    const navigation: ReactElement = (
      <Navigation
        serviceCount={stores!.services.all.length}
        workspaceCount={workspaceStore.workspaces.length}
      />
    );

    return ReactDOM.createPortal(
      <ErrorBoundary>
        <Layout
          navigation={navigation}
          closeSettings={closeSettings}
          serverHealthCheckLoading={stores!.requests.serverHealthCheckLoading}
          serverConnection={stores!.requests.serverConnection}
        >
          <Outlet />
        </Layout>
      </ErrorBoundary>,
      this.el,
    );
  }
}

export default SettingsContainer;
