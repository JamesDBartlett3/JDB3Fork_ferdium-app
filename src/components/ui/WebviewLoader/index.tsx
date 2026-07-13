import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import injectSheet, { type WithStylesProps } from 'react-jss';
import FullscreenLoader from '../FullscreenLoader';

const messages = defineMessages({
  loading: {
    id: 'service.webviewLoader.loading',
    defaultMessage: 'Loading {service}',
  },
});

const styles = theme => ({
  component: {
    background: theme.colorWebviewLoaderBackground,
    padding: 20,
    width: 'auto',
    margin: [0, 'auto'],
    borderRadius: 6,
  },
});

interface IProps extends WithStylesProps<typeof styles>, WrappedComponentProps {
  name: string;
  loaded?: boolean;
}

class WebviewLoader extends Component<IProps> {
  componentDidMount(): void {
    // eslint-disable-next-line no-console
    console.log(`[WebviewLoader] Mounted for service: ${this.props.name}`);
  }

  componentWillUnmount(): void {
    // eslint-disable-next-line no-console
    console.log(`[WebviewLoader] Unmounting for service: ${this.props.name}`);
  }

  render(): ReactElement {
    const { classes, name, loaded = false, intl } = this.props;
    // eslint-disable-next-line no-console
    console.log(
      `[WebviewLoader] Rendering for service: ${name}, loaded: ${loaded}`,
    );
    return (
      <FullscreenLoader
        className={classes.component}
        title={intl.formatMessage(messages.loading, { service: name })}
        loaded={loaded}
      />
    );
  }
}

export default injectIntl(
  injectSheet(styles, { injectTheme: true })(observer(WebviewLoader)),
);
