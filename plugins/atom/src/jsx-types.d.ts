declare namespace JSX {
  type AtomEventHandler<TEvent extends Event = Event> =
    (event: TEvent, delegatedTarget?: Element) => void;

  /** Object form enabling per-listener options: { handle: fn, once, capture, passive, signal } */
  interface EventHandlerOptions<TEvent extends Event = Event> {
    handle: AtomEventHandler<TEvent>;
    once?: boolean;
    capture?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }

  type EventProp<TEvent extends Event = Event> =
    AtomEventHandler<TEvent> | EventHandlerOptions<TEvent>;

  /** Container-level delegated handlers: { '.selector': handler } */
  interface DelegateHandlers {
    [selector: string]: AtomEventHandler<any>;
  }

  interface AtomDomAttributes {
    onClick?: EventProp<MouseEvent>;
    onDblclick?: EventProp<MouseEvent>;
    onContextmenu?: EventProp<MouseEvent>;
    onMouseDown?: EventProp<MouseEvent>;
    onMouseUp?: EventProp<MouseEvent>;
    onMouseMove?: EventProp<MouseEvent>;
    onMouseEnter?: EventProp<MouseEvent>;
    onMouseLeave?: EventProp<MouseEvent>;
    onKeydown?: EventProp<KeyboardEvent>;
    onKeyup?: EventProp<KeyboardEvent>;
    onKeypress?: EventProp<KeyboardEvent>;
    onInput?: EventProp<InputEvent>;
    onChange?: EventProp<Event>;
    onSubmit?: EventProp<Event>;
    onFocus?: EventProp<FocusEvent>;
    onBlur?: EventProp<FocusEvent>;
    onScroll?: EventProp<Event>;
    onWheel?: EventProp<WheelEvent>;
    onTouchstart?: EventProp<TouchEvent>;
    onTouchend?: EventProp<TouchEvent>;
    onTouchmove?: EventProp<TouchEvent>;
    onTouchcancel?: EventProp<TouchEvent>;
    onPointerdown?: EventProp<PointerEvent>;
    onPointerup?: EventProp<PointerEvent>;
    onPointermove?: EventProp<PointerEvent>;
    onAnimationend?: EventProp<AnimationEvent>;
    onTransitionend?: EventProp<TransitionEvent>;
    onLoad?: EventProp<Event>;
    onError?: EventProp<Event>;

    /** Verbatim custom events (on:tg-foo) and container delegation
     *  (onClickDelegate) share one pattern index signature. */
    [special: `on:${string}` | `${string}Delegate`]:
      | EventProp<Event>
      | DelegateHandlers
      | undefined;

    [prop: string]: any;
  }
  interface IntrinsicElements {
    [elemName: string]: AtomDomAttributes;
  }

  type LibraryManagedAttributes<C, P> = P & { key?: string | number | null };
}
