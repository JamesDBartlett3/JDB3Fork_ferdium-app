import { mdiClose, mdiLoading } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component, type PropsWithChildren, type ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { Outlet } from 'react-router-dom';
import { isEscapeKeyPress } from '../../jsUtils';
import Appear from '../ui/effects/Appear';
import Icon from '../ui/icon';
import ErrorBoundary from '../util/ErrorBoundary';
import type { ServerConnectionState } from '../../stores/RequestStore';

const messages = defineMessages({
  closeSettings: {
    id: 'settings.app.closeSettings',
    defaultMessage: 'Close settings',
  },
});

interface IProps extends WrappedComponentProps {
  navigation: ReactElement;
  closeSettings: () => void;
  serverHealthCheckLoading?: boolean;
  serverConnection?: ServerConnectionState;
}

@observer
class SettingsLayout extends Component<PropsWithChildren<IProps>> {
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
              <div
                style={{
                  position: 'relative',
                  opacity: serverHealthCheckLoading ? 0.5 : 1,
                  pointerEvents: serverHealthCheckLoading ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease-in-out',
                }}
              >
                <Outlet
                  context={{ serverConnection, serverHealthCheckLoading }}
                />
                {serverHealthCheckLoading && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      zIndex: 1000,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '16px',
                    }}
                  >
                    <div
                      style={{
                        animation: 'spin 1s linear infinite',
                      }}
                    >
                      <Icon icon={mdiLoading} size={2} />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>
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
              </div>
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

export default injectIntl(SettingsLayout);
