import { noop } from 'lodash';
import { observer } from 'mobx-react';
import {
  Component,
  type FormEvent,
  type FormEventHandler,
  type ReactElement,
} from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { Link } from 'react-router-dom';
import type Form from '../../../lib/Form';
import Infobox from '../../ui/Infobox';
import Radio from '../../ui/Radio';
import Button from '../../ui/button';
import { H2 } from '../../ui/headline';
import Input from '../../ui/input/index';

const messages = defineMessages({
  headline: {
    id: 'settings.account.headline',
    defaultMessage: 'Account',
  },
  headlineProfile: {
    id: 'settings.account.headlineProfile',
    defaultMessage: 'Update profile',
  },
  headlineAccount: {
    id: 'settings.account.headlineAccount',
    defaultMessage: 'Account information',
  },
  headlinePassword: {
    id: 'settings.account.headlinePassword',
    defaultMessage: 'Change password',
  },
  successInfo: {
    id: 'settings.account.successInfo',
    defaultMessage: 'Your changes have been saved',
  },
  buttonSave: {
    id: 'settings.account.buttonSave',
    defaultMessage: 'Update profile',
  },
});

interface IProps extends WrappedComponentProps {
  status: string[];
  form: Form;
  onSubmit: FormEventHandler<HTMLFormElement>;
  isSaving: boolean;
  isServerConnected?: boolean;
}

@observer
class EditUserForm extends Component<IProps> {
  submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    this.props.form.submit({
      onSuccess: form => {
        const values = form.values();
        this.props.onSubmit(values);
      },
      onError: noop,
    });
  }

  render(): ReactElement {
    const {
      // user,
      status,
      form,
      isSaving,
      intl,
      isServerConnected = true,
    } = this.props;

    const isDisabled = !isServerConnected;

    return (
      <div className="settings__main">
        <div className="settings__header">
          <span className="settings__header-item">
            <Link to="/settings/user">
              {intl.formatMessage(messages.headline)}
            </Link>
          </span>
          <span className="separator" />
          <span className="settings__header-item">
            {intl.formatMessage(messages.headlineProfile)}
          </span>
        </div>
        <div className="settings__body">
          {isDisabled && (
            <Infobox type="warning" icon="alert-circle-outline">
              Settings are not available while server is offline
            </Infobox>
          )}
          <form onSubmit={e => this.submit(e)} id="form">
            {status.length > 0 && status.includes('data-updated') && (
              <Infobox type="success" icon="checkbox-marked-circle-outline">
                {intl.formatMessage(messages.successInfo)}
              </Infobox>
            )}
            <H2>{intl.formatMessage(messages.headlineAccount)}</H2>
            <div
              className="grid__row"
              style={{
                opacity: isDisabled ? 0.6 : 1,
                pointerEvents: isDisabled ? 'none' : 'auto',
              }}
            >
              <Input
                {...form.$('firstname').bind()}
                focus
                disabled={isDisabled}
              />
              <Input {...form.$('lastname').bind()} disabled={isDisabled} />
            </div>
            <div
              style={{
                opacity: isDisabled ? 0.6 : 1,
                pointerEvents: isDisabled ? 'none' : 'auto',
              }}
            >
              <Input {...form.$('email').bind()} disabled={isDisabled} />
              <Radio field={form.$('accountType')} className="" />
              {form.$('accountType').value === 'company' && (
                <Input
                  {...form.$('organization').bind()}
                  disabled={isDisabled}
                />
              )}
            </div>
            <H2>{intl.formatMessage(messages.headlinePassword)}</H2>
            <div
              style={{
                opacity: isDisabled ? 0.6 : 1,
                pointerEvents: isDisabled ? 'none' : 'auto',
              }}
            >
              <Input
                {...form.$('oldPassword').bind()}
                showPasswordToggle
                disabled={isDisabled}
              />
              <Input
                {...form.$('newPassword').bind()}
                showPasswordToggle
                scorePassword
                disabled={isDisabled}
              />
            </div>
          </form>
        </div>
        <div className="settings__controls">
          {/* Save Button */}
          {isSaving ? (
            <Button
              type="submit"
              label={intl.formatMessage(messages.buttonSave)}
              loaded={!isSaving}
              buttonType="secondary"
              disabled
              onClick={noop}
            />
          ) : (
            <Button
              type="submit"
              label={intl.formatMessage(messages.buttonSave)}
              htmlForm="form"
              onClick={noop}
              disabled={isDisabled}
            />
          )}
        </div>
      </div>
    );
  }
}

export default injectIntl(EditUserForm);
