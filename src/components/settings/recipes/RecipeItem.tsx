import classnames from 'classnames';
import { observer } from 'mobx-react';
import { Component, type MouseEventHandler } from 'react';
import { Tooltip as ReactTooltip } from 'react-tooltip';
import RecipePreview from '../../../models/RecipePreview';

interface IProps {
  recipe: RecipePreview;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  disabledTooltip?: string;
}

@observer
class RecipeItem extends Component<IProps> {
  constructor(props: IProps) {
    super(props);
  }

  render() {
    const { recipe, onClick, disabled, disabledTooltip } = this.props;

    return (
      <>
        <button
          type="button"
          className={classnames('recipe-teaser', {
            'recipe-teaser--disabled': disabled,
          })}
          onClick={disabled ? undefined : onClick}
          // Use data-tooltip attributes (react-tooltip v5 pattern) so the
          // tooltip fires even though the button is not natively disabled.
          // We intentionally avoid the native `disabled` attribute because it
          // suppresses mouse events and would prevent the tooltip from showing.
          data-tooltip-id="tooltip-recipe-item"
          data-tooltip-content={disabled ? disabledTooltip : undefined}
        >
          {recipe.isDevRecipe && (
            <span className="recipe-teaser__dev-badge">dev</span>
          )}
          <img src={recipe.icons?.svg} className="recipe-teaser__icon" alt="" />
          <span className="recipe-teaser__label">{recipe.name}</span>
          {recipe.aliases && recipe.aliases.length > 0 && (
            <span className="recipe-teaser__alias_label">
              {`Aliases: ${recipe.aliases.join(', ')}`}
            </span>
          )}
        </button>
        <ReactTooltip
          id="tooltip-recipe-item"
          place="top"
          variant="dark"
          style={{ height: 'auto' }}
        />
      </>
    );
  }
}

export default RecipeItem;
