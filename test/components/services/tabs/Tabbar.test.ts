import type TabBarClass from '../../../../src/components/services/tabs/Tabbar';

// TabBarSortableList pulls in TabItem -> electron/remote chains; the sorting
// guard logic under test lives entirely on the TabBar class prototype, so the
// sortable list can be stubbed out.
jest.mock(
  '../../../../src/components/services/tabs/TabBarSortableList',
  () => ({
    __esModule: true,
    default: () => null,
  }),
);

const TabBar = jest.requireActual<
  typeof import('../../../../src/components/services/tabs/Tabbar')
>('../../../../src/components/services/tabs/Tabbar').default;

const createTabbar = ({ isWriteLocked = false } = {}) => {
  const reorder = jest.fn();
  const enableToolTip = jest.fn();

  // onSortEnd/shouldPreventSorting are instance arrow properties, so the
  // component must be instantiated rather than prototype-spawned. Only the
  // props exercised by the sorting guards are provided.
  const tabbar = new TabBar({
    isWriteLocked,
    reorder,
    enableToolTip,
  } as any) as TabBarClass;

  return { tabbar, reorder, enableToolTip };
};

describe('Tabbar write-lock', () => {
  it('finishes sorting when writes are permitted', () => {
    const { tabbar, reorder, enableToolTip } = createTabbar();

    tabbar.onSortEnd({ oldIndex: 0, newIndex: 1 });

    expect(enableToolTip).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith({ oldIndex: 0, newIndex: 1 });
  });

  it('cannot finish sorting while write-locked', () => {
    const { tabbar, reorder, enableToolTip } = createTabbar({
      isWriteLocked: true,
    });

    tabbar.onSortEnd({ oldIndex: 0, newIndex: 1 });

    expect(enableToolTip).toHaveBeenCalledTimes(1);
    expect(reorder).not.toHaveBeenCalled();
  });

  it('cannot start sorting while write-locked', () => {
    const { tabbar } = createTabbar({ isWriteLocked: true });

    expect(tabbar.shouldPreventSorting({ target: { tagName: 'LI' } })).toBe(
      true,
    );
  });

  it('can start sorting on a list item when writes are permitted', () => {
    const { tabbar } = createTabbar({ isWriteLocked: false });

    expect(tabbar.shouldPreventSorting({ target: { tagName: 'LI' } })).toBe(
      false,
    );
    // Non-list-element targets are still rejected regardless of the lock.
    expect(tabbar.shouldPreventSorting({ target: { tagName: 'DIV' } })).toBe(
      true,
    );
  });
});
