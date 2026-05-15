"use strict";

exports.__esModule = true;
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _reactDraggable = require("react-draggable");
var _utils = require("./utils");
var _propTypes = require("./propTypes");
const _excluded = ["children", "className", "draggableOpts", "width", "height", "handle", "handleSize", "lockAspectRatio", "axis", "minConstraints", "maxConstraints", "onResize", "onResizeStop", "onResizeStart", "resizeHandles", "transformScale"];
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
// The base <Resizable> component.
// This component does not have state and relies on the parent to set its props based on callback data.
class Resizable extends React.Component {
  constructor() {
    super(...arguments);
    this.handleRefs = {};
    this.lastHandleRect = null;
    this.slack = null;
    this.lastSize = null;
  }
  componentWillUnmount() {
    this.resetData();
  }
  resetData() {
    this.lastHandleRect = this.slack = this.lastSize = null;
  }

  // Clamp width and height within provided constraints
  runConstraints(width, height) {
    const _this$props = this.props,
      minConstraints = _this$props.minConstraints,
      maxConstraints = _this$props.maxConstraints,
      lockAspectRatio = _this$props.lockAspectRatio;
    // short circuit
    if (!minConstraints && !maxConstraints && !lockAspectRatio) return [width, height];

    // If constraining to min and max, we need to also fit width and height to aspect ratio.
    if (lockAspectRatio) {
      const ratio = this.props.width / this.props.height;
      const deltaW = width - this.props.width;
      const deltaH = height - this.props.height;

      // Find which coordinate was greater and should push the other toward it.
      // E.g.:
      // ratio = 1, deltaW = 10, deltaH = 5, deltaH should become 10.
      // ratio = 2, deltaW = 10, deltaH = 6, deltaW should become 12.
      if (Math.abs(deltaW) > Math.abs(deltaH * ratio)) {
        height = width / ratio;
      } else {
        width = height * ratio;
      }
    }
    const oldW = width,
      oldH = height;

    // Add slack to the values used to calculate bound position. This will ensure that if
    // we start removing slack, the element won't react to it right away until it's been
    // completely removed.
    let _ref = this.slack || [0, 0],
      slackW = _ref[0],
      slackH = _ref[1];
    width += slackW;
    height += slackH;
    if (minConstraints) {
      width = Math.max(minConstraints[0], width);
      height = Math.max(minConstraints[1], height);
    }
    if (maxConstraints) {
      width = Math.min(maxConstraints[0], width);
      height = Math.min(maxConstraints[1], height);
    }

    // If the width or height changed, we must have introduced some slack. Record it for the next iteration.
    this.slack = [slackW + (oldW - width), slackH + (oldH - height)];
    return [width, height];
  }

  /**
   * Wrapper around drag events to provide more useful data.
   *
   * @param  {String} handlerName Handler name to wrap.
   * @return {Function}           Handler function.
   */
  resizeHandler(handlerName, axis) {
    return (e, _ref2) => {
      var _this$lastSize$width, _this$lastSize, _this$lastSize$height, _this$lastSize2;
      let node = _ref2.node,
        deltaX = _ref2.deltaX,
        deltaY = _ref2.deltaY;
      // Reset data in case it was left over somehow (should not be possible)
      if (handlerName === 'onResizeStart') this.resetData();

      // Axis restrictions
      const canDragX = (this.props.axis === 'both' || this.props.axis === 'x') && axis !== 'n' && axis !== 's';
      const canDragY = (this.props.axis === 'both' || this.props.axis === 'y') && axis !== 'e' && axis !== 'w';
      // No dragging possible.
      if (!canDragX && !canDragY) return;

      // Decompose axis for later use
      const axisV = axis[0];
      const axisH = axis[axis.length - 1]; // intentionally not axis[1], so that this catches axis === 'w' for example

      // Track the element being dragged to account for changes in position.
      // If a handle's position is changed between callbacks, we need to factor this in to the next callback.
      // Failure to do so will cause the element to "skip" when resized upwards or leftwards.
      const handleRect = node.getBoundingClientRect();
      if (this.lastHandleRect != null) {
        // If the handle has repositioned on either axis since last render,
        // we need to increase our callback values by this much.
        // Only checking 'n', 'w' since resizing by 's', 'w' won't affect the overall position on page,
        if (axisH === 'w') {
          const deltaLeftSinceLast = handleRect.left - this.lastHandleRect.left;
          deltaX += deltaLeftSinceLast;
        }
        if (axisV === 'n') {
          const deltaTopSinceLast = handleRect.top - this.lastHandleRect.top;
          deltaY += deltaTopSinceLast;
        }
      }
      // Storage of last rect so we know how much it has really moved.
      this.lastHandleRect = handleRect;

      // Reverse delta if using top or left drag handles.
      if (axisH === 'w') deltaX = -deltaX;
      if (axisV === 'n') deltaY = -deltaY;

      // Update w/h by the deltas. Also factor in transformScale.
      // Use lastSize (if available) instead of props to avoid losing deltas
      // when React can't re-render between consecutive mouse events.
      const baseWidth = (_this$lastSize$width = (_this$lastSize = this.lastSize) == null ? void 0 : _this$lastSize.width) != null ? _this$lastSize$width : this.props.width;
      const baseHeight = (_this$lastSize$height = (_this$lastSize2 = this.lastSize) == null ? void 0 : _this$lastSize2.height) != null ? _this$lastSize$height : this.props.height;
      let width = baseWidth + (canDragX ? deltaX / this.props.transformScale : 0);
      let height = baseHeight + (canDragY ? deltaY / this.props.transformScale : 0);

      // Run user-provided constraints.
      // For onResizeStop, use the last size from onResize rather than recalculating.
      // This avoids issues where props.width/height are stale due to React's batched updates.
      var _this$runConstraints = this.runConstraints(width, height);
      width = _this$runConstraints[0];
      height = _this$runConstraints[1];
      if (handlerName === 'onResizeStop' && this.lastSize) {
        var _this$lastSize3 = this.lastSize;
        width = _this$lastSize3.width;
        height = _this$lastSize3.height;
      }

      // Compare against the base (lastSize-or-props) so that callbacks correctly
      // suppress when the net delta is zero, even if props are stale relative to
      // the accumulated lastSize.
      const dimensionsChanged = width !== baseWidth || height !== baseHeight;

      // Store the size for use in onResizeStop. We do this after the onResizeStop check
      // above so we don't overwrite the stored value with a potentially stale calculation.
      if (handlerName !== 'onResizeStop') {
        this.lastSize = {
          width,
          height
        };
      }

      // Call user-supplied callback if present.
      const cb = typeof this.props[handlerName] === 'function' ? this.props[handlerName] : null;
      // Don't call 'onResize' if dimensions haven't changed.
      const shouldSkipCb = handlerName === 'onResize' && !dimensionsChanged;
      if (cb && !shouldSkipCb) {
        e.persist == null || e.persist();
        cb(e, {
          node,
          size: {
            width,
            height
          },
          handle: axis
        });
      }

      // Reset internal data
      if (handlerName === 'onResizeStop') this.resetData();
    };
  }

  // Render a resize handle given an axis & DOM ref. Ref *must* be attached for
  // the underlying draggable library to work properly.
  renderResizeHandle(handleAxis, ref) {
    const handle = this.props.handle;
    // No handle provided, make the default
    if (!handle) {
      return /*#__PURE__*/React.createElement("span", {
        className: "react-resizable-handle react-resizable-handle-" + handleAxis,
        ref: ref
      });
    }
    // Handle is a function, such as:
    // `handle={(handleAxis) => <span className={...} />}`
    if (typeof handle === 'function') {
      return handle(handleAxis, ref);
    }
    // Handle is a React component (composite or DOM).
    const isDOMElement = typeof handle.type === 'string';
    const props = _objectSpread({
      ref
    }, isDOMElement ? {} : {
      handleAxis
    });
    return /*#__PURE__*/React.cloneElement(handle, props);
  }
  render() {
    // Pass along only props not meant for the `<Resizable>`.`
    // eslint-disable-next-line no-unused-vars
    const _this$props2 = this.props,
      children = _this$props2.children,
      className = _this$props2.className,
      draggableOpts = _this$props2.draggableOpts,
      width = _this$props2.width,
      height = _this$props2.height,
      handle = _this$props2.handle,
      handleSize = _this$props2.handleSize,
      lockAspectRatio = _this$props2.lockAspectRatio,
      axis = _this$props2.axis,
      minConstraints = _this$props2.minConstraints,
      maxConstraints = _this$props2.maxConstraints,
      onResize = _this$props2.onResize,
      onResizeStop = _this$props2.onResizeStop,
      onResizeStart = _this$props2.onResizeStart,
      resizeHandles = _this$props2.resizeHandles,
      transformScale = _this$props2.transformScale,
      p = _objectWithoutPropertiesLoose(_this$props2, _excluded);

    // What we're doing here is getting the child of this element, and cloning it with this element's props.
    // We are then defining its children as:
    // 1. Its original children (resizable's child's children), and
    // 2. One or more draggable handles.
    return (0, _utils.cloneElement)(children, _objectSpread(_objectSpread({}, p), {}, {
      className: (className ? className + " " : '') + "react-resizable",
      children: [...React.Children.toArray(children.props.children), ...resizeHandles.map(handleAxis => {
        var _this$handleRefs$hand;
        // Create a ref to the handle so that `<DraggableCore>` doesn't have to use ReactDOM.findDOMNode().
        const ref = (_this$handleRefs$hand = this.handleRefs[handleAxis]) != null ? _this$handleRefs$hand : this.handleRefs[handleAxis] = /*#__PURE__*/React.createRef();
        return /*#__PURE__*/React.createElement(_reactDraggable.DraggableCore, _extends({}, draggableOpts, {
          nodeRef: ref,
          key: "resizableHandle-" + handleAxis,
          onStop: this.resizeHandler('onResizeStop', handleAxis),
          onStart: this.resizeHandler('onResizeStart', handleAxis),
          onDrag: this.resizeHandler('onResize', handleAxis)
        }), this.renderResizeHandle(handleAxis, ref));
      })]
    }));
  }
}
exports.default = Resizable;
Resizable.propTypes = _propTypes.resizableProps;
Resizable.defaultProps = {
  axis: 'both',
  handleSize: [20, 20],
  lockAspectRatio: false,
  minConstraints: [20, 20],
  maxConstraints: [Infinity, Infinity],
  resizeHandles: ['se'],
  transformScale: 1
};