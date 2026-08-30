import { mdiClose, mdiFlash, mdiLoading } from '@mdi/js';
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement, type ReactNode } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { Outlet } from 'react-router-dom';
import type { StoresProps } from '../../@types/ferdium-components.types';
import { isEscapeKeyPress } from '../../jsUtils';
import type { ServerConnectionState } from '../../stores/RequestStore';
import InfoBar from '../ui/InfoBar';
import Appear from '../ui/effects/Appear';
import Icon from '../ui/icon';
import ErrorBoundary from '../util/ErrorBoundary';

const messages = defineMessages({
  closeSettings: {
    id: 'settings.app.closeSettings',
    defaultMessage: 'Close settings',
  },
  servicesSyncConflict: {
    id: 'infobar.servicesSyncConflict',
    defaultMessage:
      'Service changes differ between local cache and server. Sync with the server to continue making changes.',
  },
  buttonUseServerVersion: {
    id: 'infobar.buttonUseServerVersion',
    defaultMessage: 'Use server version',
  },
});

interface IProps extends WrappedComponentProps, Partial<StoresProps> {
  navigation: ReactElement;
  closeSettings: () => void;
  serverHealthCheckLoading?: boolean;
  serverConnection?: ServerConnectionState;
  hasPendingSyncConflict?: boolean;
  // eslint-disable-next-line react/no-unused-prop-types
  children?: ReactNode;
}

class SettingsLayout extends Component<IProps> {
  constructor(props: IProps) {
    super(props);

    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  componentDidMount(): void {
    document.addEventListener('keydown', this.handleKeyDown, false);
  }

  componentWillUnmount(): void {
    document.removeEventListener('keydown', this.handleKeyDown, false);
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (isEscapeKeyPress(e.key)) {
      this.props.closeSettings();
    }
  }

  render(): ReactElement {
    const {
      navigation,
      closeSettings,
      intl,
      serverHealthCheckLoading = false,
      serverConnection = 'connected',
      hasPendingSyncConflict = false,
      stores,
    } = this.props;

    return (
      <Appear transitionName="fadeIn-fast">
        <div className="settings-wrapper">
          <ErrorBoundary>
            <button
              type="button"
              className="settings-wrapper__action"
              onClick={closeSettings}
              aria-label={intl.formatMessage(messages.closeSettings)}
            />
            <div className="settings franz-form">
              {navigation}
              <div className="settings__content">
                {hasPendingSyncConflict && (
                  <InfoBar
                    type="warning"
                    position="top"
                    ctaLabel={intl.formatMessage(
                      messages.buttonUseServerVersion,
                    )}
                    sticky
                    onClick={() => stores?.services.applyPendingServerSync()}
                  >
                    <Icon icon={mdiFlash} />
                    {intl.formatMessage(messages.servicesSyncConflict)}
                  </InfoBar>
                )}
                <Outlet
                  context={{
                    serverConnection,
                    serverHealthCheckLoading,
                    hasPendingSyncConflict,
                  }}
                />
              </div>
              {serverHealthCheckLoading && (
                <div
                  style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '16px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    padding: '24px',
                    borderRadius: '8px',
                  }}
                >
                  <div
                    style={{
                      animation: 'spin 1s linear infinite',
                    }}
                  >
                    <Icon icon={mdiLoading} size={2} />
                  </div>
                  <div
                    style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}
                  >
                    Checking server connection...
                  </div>
                  <style>
                    {`
                      @keyframes spin {
                        from {
                          transform: rotate(0deg);
                        }
                        to {
                          transform: rotate(360deg);
                        }
                      }
                    `}
                  </style>
                </div>
              )}
              <button
                type="button"
                className="settings__close"
                onClick={closeSettings}
                aria-label={intl.formatMessage(messages.closeSettings)}
              >
                <Icon icon={mdiClose} size={1.35} />
              </button>
            </div>
          </ErrorBoundary>
        </div>
      </Appear>
    );
  }
}

export default injectIntl<'intl', IProps>(
  inject('stores', 'actions')(observer(SettingsLayout)),
);
