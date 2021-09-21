/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

function subscribeInternal<E = AnyEvent>(this: Emitter<E>, event: E, subscriber: Subscriber): Subscription {
    this.on(event, subscriber);

    return () => {
        this.off(event, subscriber);
    };
}

/**
 * Eevent subscription that allows to unsubscribe from a given event.
 */
export type Subscription = () => void;

/**
 * Event subscriber.
 */
export type Subscriber = (...args: any[]) => void;

/**
 * Default event type.
 */
export type AnyEvent = string | symbol;

/**
 * An object that provides an ability to subscribe and unsubscribe from its events.
 */
export interface Observable<E = AnyEvent> {
    /**
     * Adds the subscriber function to the end of the subscribers array for the event named eventName.
     * No checks are made to see if the subscriber has already been added.
     * @param eventName - Target event name.
     * @param subscriber - The callback function.
     */
    subscribe(event: E, subscriber: Subscriber): Subscription;
}

/**
 * An object that derives from EventEmitter.
 */
export interface Emitter<E = AnyEvent> {
    /**
     * Adds the subscriber function to the end of the subscribers array for the event named eventName.
     * No checks are made to see if the subscriber has already been added.
     * @param eventName - Target event name.
     * @param subscriber - The callback function.
     */
    on(eventName: E, subscriber: Subscriber): this;

    /**
     * Removes the specified subscriber from the subscriber array for the event named eventName.
     * @param eventName - Target event name.
     * @param subscriber - The callback function.
     */
    off(eventName: E, subscriber: Subscriber): this;
}

/**
 * Checks whether a given value implements Observable interface.
 * @param target - Target object to inspect.
 */
export function isObservable(target: any): boolean {
    return typeof (target as Observable)?.subscribe === 'function';
}

/**
 * Checks whether a given value implements Emitter interface.
 * @param target - Target object to inspect.
 */
export function isEmitter(target: any): boolean {
    return typeof (target as Emitter)?.on === 'function' && typeof (target as Emitter)?.off === 'function';
}

/**
 * Creates an observable object from a given event emitter based object.
 * @param target - Target event emitter based object.
 */
export function toObservable<T extends Emitter, E = AnyEvent>(target: T): Observable<E> {
    if (!isEmitter(target)) {
        throw new Error('Target must implement Emitter interface');
    }

    return {
        subscribe: subscribeInternal.bind(target),
    };
}

/**
 * Generic functions that subscribes to an object that implements either Observable or Emitter interfaces.
 * @param target - Target object that must implement either Observable or Emitter interfaces.
 * @param event - Target event name.
 * @param subscriber - Event subscriber.
 */
export function subscribe(target: Observable | Emitter, event: string | symbol, subscriber: Subscriber): Subscription {
    if (isEmitter(target)) {
        return subscribeInternal.call(target as Emitter, event, subscriber);
    }

    if (isObservable(target)) {
        return (target as Observable).subscribe(event, subscriber);
    }

    throw new Error('Resource must implement either Emitter or Observable interfaces');
}
