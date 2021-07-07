import React, { Component, ReactElement } from 'react';
import {
  Platform,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  View,
  Text,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import * as Animatable from 'react-native-animatable';
import { defaultProps, propTypes } from './SegmentedPickerPropTypes';
import styles from './SegmentedPickerStyles';
import Toolbar from '../Toolbar';
import SelectionMarker from '../SelectionMarker';
import UIPicker from '../UIPicker';
import Cache from '../../services/Cache';
import UIPickerManager from '../../services/UIPickerManager';
import {
  PickerColumn,
  PickerItem,
  PickerOptions,
  Selections,
  SelectionEvent,
  UIPickerValueChangeEvent,
} from '../../config/interfaces';
import {
  ANIMATION_TIME,
  GUTTER_HEIGHT,
  ITEM_HEIGHTS,
  TEST_IDS,
  TRACKING,
} from '../../config/constants';

const ITEM_HEIGHT = Platform.select(ITEM_HEIGHTS);

const {
  FLAT_LIST_REF,
  LAST_SCROLL_OFFSET,
  SCROLL_DIRECTION,
  IS_DRAGGING,
  IS_MOMENTUM_SCROLLING,
  IS_DIRTY,
} = TRACKING;

export interface Props {
  native: boolean;
  options: PickerOptions;
  defaultSelections: Selections;
  size: number;
  confirmText: string;
  nativeTestID: string;
  // Styling
  confirmTextColor: string;
  pickerItemTextColor: string;
  toolbarBackgroundColor: string;
  toolbarBorderColor: string;
  selectionBackgroundColor: string;
  selectionBorderColor: string;
  backgroundColor: string;
  // Events
  onValueChange: (event: SelectionEvent) => void;
  onCancel: (event: Selections) => void,
  onConfirm: (event: Selections) => void,
}

interface State {
  pickersHeight: number;
}

interface RenderablePickerItem extends PickerItem {
  key: string;
  column: string;
}

export default class SegmentedPicker extends Component<Props, State> {
  static propTypes = propTypes;
  static defaultProps = defaultProps as Partial<Props>;

  /**
   * @static
   * Decorates the `options` prop with necessary defaults for missing values.
   * @param options {PickerOptions}
   * @return {PickerOptions}
   */
  static ApplyPickerOptionDefaults = (options: PickerOptions): PickerOptions => (
    options.map(column => ({
      ...column,
      flex: column.flex || 1,
    }))
  );

  cache: Cache = new Cache(); // Used as an internal synchronous state (fast)
  uiPickerManager: UIPickerManager = new UIPickerManager();
  selectionChanges: Selections = {};
  modalContainerRef: React.RefObject<any> = React.createRef();
  pickerContainerRef: React.RefObject<any> = React.createRef();

  constructor(props: Props) {
    super(props);
    this.state = {
      pickersHeight: 0,
    };
  }

  /**
   * Selects a specific picker item `label` in the picklist and focuses it.
   * External Usage: `ref.current.selectLabel()`
   * @param {string} label
   * @param {string} column
   * @param {boolean = true} animated
   * @param {boolean = true} emitEvent: Specify whether to call the `onValueChange` event.
   * @param {boolean = false} zeroFallback: Select the first list item if not found.
   * @return {void}
   */
  selectLabel = (
    label: string,
    column: string,
    animated: boolean = true,
    emitEvent: boolean = true,
    zeroFallback: boolean = false,
  ): void => {
    const index = this.findItemIndexByLabel(label, column);
    if (index !== -1) {
      this.selectIndex(index, column, animated, emitEvent);
    } else if (this.columnItems(column).length > 0 && zeroFallback) {
      this.selectIndex(0, column, animated, emitEvent);
    }
  };

  /**
   * Selects a specific picker item `value` in the picklist and focuses it.
   * External Usage: `ref.current.selectValue()`
   * @param {string} value
   * @param {string} column
   * @param {boolean = true} animated
   * @param {boolean = true} emitEvent: Specify whether to call the `onValueChange` event.
   * @param {boolean = false} zeroFallback: Select the first list item if not found.
   * @return {void}
   */
  selectValue = (
    value: string,
    column: string,
    animated: boolean = true,
    emitEvent: boolean = true,
    zeroFallback: boolean = false,
  ): void => {
    const index = this.findItemIndexByValue(value, column);
    if (index !== -1) {
      this.selectIndex(index, column, animated, emitEvent);
    } else if (this.columnItems(column).length > 0 && zeroFallback) {
      this.selectIndex(0, column, animated, emitEvent);
    }
  };

  /**
   * Selects a specific label in the picklist and focuses it using it's list index.
   * External Usage: `ref.current.selectLabel()`
   * @param {number} index
   * @param {string} column
   * @param {boolean = true} animated
   * @param {boolean = true} emitEvent: Specify whether to call the `onValueChange` event.
   * @return {void}
   */
  selectIndex = (
    index: number,
    column: string,
    animated: boolean = true,
    emitEvent: boolean = true,
  ): void => {
    if (this.isNative()) {
      this.uiPickerManager.selectIndex(index, column, animated);
      return;
    }
    const { onValueChange } = this.props;
    const list = this.cache.get(`${FLAT_LIST_REF}${column}`);
    if (!list) {
      return;
    }
    list.scrollToIndex({
      index,
      animated,
    });
    const items = this.columnItems(column);
    if (!this.selectionChanges[column]
      || (this.selectionChanges[column]
        && this.selectionChanges[column] !== items[index].value)
    ) {
      this.selectionChanges = {
        ...this.selectionChanges,
        [column]: items[index].value,
      };
      if (emitEvent) {
        onValueChange({ column, value: items[index].value });
      }
    }
  };

  /**
   * Returns the current picklist selections as they appear on the UI.
   * External Usage: `await ref.current.getCurrentSelections()`
   * @return {Promise<Selections>} {column1: 'value', column2: 'value', ...}
   */
  getCurrentSelections = async (): Promise<Selections> => {
    if (this.isNative()) {
      const nativeSelections = await this.uiPickerManager.getCurrentSelections();
      return nativeSelections;
    }
    const { options } = this.props;
    return Promise.resolve(
      options.reduce((columns, column) => {
        const lastOffset = this.cache.get(`${LAST_SCROLL_OFFSET}${column.key}`);
        const index = this.nearestOptionIndex(
          lastOffset || 0,
          column.key,
        );
        const items = this.columnItems(column.key);
        return {
          ...columns,
          [column.key]: items[index]?.value,
        };
      }, {}),
    );
  };

  /**
   * @private
   * Should the picker be powered by a native module, or with plain JavaScript?
   * Currently only available as an opt-in option for iOS devices.
   * @return {boolean}
   */
  private isNative = (): boolean => (
    this.props.native && Platform.OS === 'ios'
  );

  /**
   * Filters the `options` prop for a specific column `key`.
   * @param {string} key
   * @return {PickerColumn}
   */
  private getColumn = (key: string): PickerColumn => (
    this.props.options.filter(c => c.key === key)[0]
  );

  /**
   * Returns the picker list items for a specific column `key`.
   * @param {string} key
   * @return {Array<PickerItem>}
   */
  private columnItems = (key: string): Array<PickerItem> => this.getColumn(key)?.items || [];

  /**
   * @private
   * @param {string} label
   * @param {string} column
   * @return {number}
   */
  private findItemIndexByLabel = (label: string, column: string): number => {
    const items = this.columnItems(column);
    return items.findIndex(item => (
      item.label === label
    ));
  };

  /**
   * @private
   * @param {string} value
   * @param {string} column
   * @return {number}
   */
  private findItemIndexByValue = (value: string, column: string): number => {
    const items = this.columnItems(column);
    return items.findIndex(item => (
      item.value === value
    ));
  };

  /**
   * @private
   * Determines the index of the nearest option in the list based off the specified Y
   * scroll offset.
   * @param {number} offsetY: The scroll view content offset from react native (should
   * always be a positive integer).
   * @param {string} column
   * @return {number}
   */
  private nearestOptionIndex = (offsetY: number, column: string): number => {
    const scrollDirection = this.cache.get(`${SCROLL_DIRECTION}${column}`) || 1;
    const rounding = (scrollDirection === 0) ? 'floor' : 'ceil';
    const adjustedOffsetY = (scrollDirection === 0) ? (
      (offsetY / ITEM_HEIGHT) + 0.35
    ) : (
      (offsetY / ITEM_HEIGHT) - 0.35
    );
    let nearestArrayMember = Math[rounding](adjustedOffsetY) || 0;
    // Safety checks making sure we don't return an out of range index
    const columnSize = this.columnItems(column).length;
    if (Math.sign(nearestArrayMember) === -1) {
      nearestArrayMember = 0;
    } else if (nearestArrayMember > columnSize - 1) {
      nearestArrayMember = columnSize - 1;
    }
    return nearestArrayMember;
  };

   /**
   * @private
   * Forwards value changes onto the client from the Native iOS UIPicker when it is in use
   * over the default JavaScript picker implementation.
   * @param {UIPickerValueChangeEvent}
   * @return {void}
   */
  private uiPickerValueChange = (
    { nativeEvent: { column, value } }: UIPickerValueChangeEvent,
  ): void => {
    const { onValueChange } = this.props;
    onValueChange({ column, value });
  };

  render() {
    const {
      nativeTestID,
      options,
      defaultSelections,
      size,
      confirmText,
      confirmTextColor,
      pickerItemTextColor,
      toolbarBackgroundColor,
      toolbarBorderColor,
      selectionBackgroundColor,
      selectionBorderColor,
      backgroundColor,
    } = this.props;

    return (
      <View style={styles.selectableArea}>
        {/* Native iOS Picker is enabled */}
        {this.isNative() && (
          <View style={styles.nativePickerContainer}>
            <UIPicker
              ref={this.uiPickerManager.reactRef}
              nativeTestID={nativeTestID}
              style={styles.nativePicker}
              options={SegmentedPicker.ApplyPickerOptionDefaults(options)}
              defaultSelections={defaultSelections}
              onValueChange={this.uiPickerValueChange}
              onEmitSelections={this.uiPickerManager.ingestSelections}
              theme={{
                itemHeight: ITEM_HEIGHT,
                selectionBackgroundColor,
                selectionBorderColor,
                pickerItemTextColor,
              }}
            />
          </View>
        )}
      </View>
    );
  }
}
