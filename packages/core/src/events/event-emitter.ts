type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private _events = new Map<string, EventListener[]>();
  private _onceWrappers = new WeakMap<EventListener, Map<string, EventListener>>();

  on(event: string, listener: EventListener): this {
    const listeners = this._events.get(event);
    if (listeners) {
      listeners.push(listener);
    } else {
      this._events.set(event, [listener]);
    }
    return this;
  }

  once(event: string, listener: EventListener): this {
    const byEvent = this._onceWrappers.get(listener) ?? new Map<string, EventListener>();
    const existing = byEvent.get(event);
    if (existing) {
      const listeners = this._events.get(event);
      if (listeners && listeners.includes(existing)) return this;
      this.on(event, existing);
      return this;
    }
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      listener(...args);
    };
    byEvent.set(event, wrapper);
    this._onceWrappers.set(listener, byEvent);
    this.on(event, wrapper);
    return this;
  }

  off(event: string, listener: EventListener): this {
    const listeners = this._events.get(event);
    if (!listeners) return this;
    const idx = listeners.lastIndexOf(listener);
    if (idx !== -1) {
      listeners.splice(idx, 1);
      if (listeners.length === 0) this._events.delete(event);
    }
    const byEvent = this._onceWrappers.get(listener);
    const wrapper = byEvent?.get(event);
    if (byEvent && wrapper) {
      const idx2 = listeners.lastIndexOf(wrapper);
      if (idx2 !== -1) {
        listeners.splice(idx2, 1);
        if (listeners.length === 0) this._events.delete(event);
      }
      byEvent.delete(event);
      if (byEvent.size === 0) this._onceWrappers.delete(listener);
    }
    return this;
  }

  addListener(event: string, listener: EventListener): this {
    return this.on(event, listener);
  }

  removeListener(event: string, listener: EventListener): this {
    return this.off(event, listener);
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this._events.get(event);
    if (!listeners || listeners.length === 0) return false;
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  listeners(event: string): EventListener[] {
    return [...(this._events.get(event) || [])];
  }

  eventNames(): string[] {
    return Array.from(this._events.keys());
  }

  listenerCount(event: string): number {
    return this._events.get(event)?.length || 0;
  }
}
