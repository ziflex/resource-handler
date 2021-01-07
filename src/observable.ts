/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Eevent subscription that allows to unsubscribe from a given event.
 */
export type Subscription = () => void;

/**
 * Event subscriber.
 */
export type Subscriber = (...args: any[]) => void;

/**
 * An object that provides an ability to subscribe and unsubscribe from its events.
 */
export interface Observable {
    /**
     * Adds an subscriber.
     * @param event - Event name to observe.
     * @param subscriber - Event name handler.
     */
    subscribe(event: string | symbol, subscriber: Subscriber): Subscription;
}

/**
 * An object that derives from EventEmitter.
 */
export interface Emitter {
    on(event: string | symbol, subscriber: Subscriber): this;

    off(event: string | symbol, subscriber: Subscriber): this;
}

/**
 * Checks whether a given value implements Observable interface.
 * @param target - Target object to inspect.
 */
export function isObservable(target: any): boolean {
    return typeof target?.subscribe === 'function';
}

/**
 * Checks whether a given value implements Emitter interface.
 * @param target - Target object to inspect.
 */
export function isEmitter(target: any): boolean {
    return typeof target?.on === 'function' && typeof target?.off === 'function';
}

/**
 * Creates an observable object from a given event emitter based object.
 * @param target - Target event emitter based object.
 */
export function toObservable<T extends Emitter>(target: T): Observable {
    if (!isEmitter(target)) {
        throw new Error('Target must implement Emitter interface');
    }

    return {
        subscribe(event, subscriber) {
            target.on(event, subscriber);

            return () => {
                target.off(event, subscriber);
            };
        },
    };
}

/**
 * Generic functions that subscribes to an object that implements either Observable or Emitter interfaces.
 * @param target - Target object that must implement either Observable or Emitter interfaces.
 * @param event - Target event name.
 * @param subscriber - Event subscriber.
 */
export function subscribe(target: Observable | Emitter, event: string | symbol, subscriber: Subscriber): Subscription {
    if (isObservable(target)) {
        return (target as Observable).subscribe(event, subscriber);
    }

    if (!isEmitter(target)) {
        throw new Error('Resource must implement either Observable or Emitter interfaces');
    }

    const emitter = target as Emitter;

    emitter.on(event, subscriber);

    return () => {
        emitter.off(event, subscriber);
    };
}
