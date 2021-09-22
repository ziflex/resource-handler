/* eslint-disable @typescript-eslint/no-explicit-any */
import { Observable, Emitter, AnyEvent } from './observable';

/**
 * A closable object that supports an async closing operation.
 */
export interface Closable {
    close(): Promise<void>;
}

/**
 * A custom close function.
 */
export type CloseFn<T> = (src: T) => void | Promise<void>;

/**
 * Resource that implements Observable interface.
 */
export interface ObservableResource<E = AnyEvent> extends Observable<E>, Closable {}

/**
 * Resource that implements Emitter interface.
 */
export interface EmitterResource<E = AnyEvent> extends Emitter<E>, Closable {}

/**
 * Resource is an object that needs to be handled.
 */
export type Resource<E = AnyEvent> = ObservableResource<E> | EmitterResource<E>;

/**
 * Resource closer is a function that creates a new resource.
 */
export type ResourceFactory<T extends Resource> = () => Promise<T>;

/**
 * Resource closer is a function that receives a current resource and closes it.
 */
export type ResourceCloser<T extends Resource> = (res: T) => Promise<void>;

function closer<T>(this: T, fn: CloseFn<T>): Promise<void> {
    try {
        return Promise.resolve(fn(this));
    } catch (e) {
        return Promise.reject(e);
    }
}

/**
 * Makes a given object Closable by adding '.close' method using a given key or function.
 * @param input - Any object.
 * @param close - Either a function implementing the closing functionality or a key/symbol pointing to one within a given object.
 * @returns Extended object with '.close' method which implements Closable interface.
 */
export function toClosable<T>(input: T, close: CloseFn<T> | string | symbol): T & Closable {
    if (input == null) {
        throw new Error('Input object is required');
    }

    const out = input as T & Closable;

    if (typeof close === 'string' || typeof close === 'symbol') {
        const key = close as string;
        const fn = (input as any)[key];

        if (typeof fn !== 'function') {
            throw new Error(`Given key must refer to a function: ${key}`);
        }

        out.close = closer.bind(input, fn);
    } else if (typeof close === 'function') {
        const fn = close as any;

        out.close = closer.bind(input, fn);
    } else {
        throw new Error(`Expected "closer" to be "function", "string" or "symbol", but got "${typeof close}"`);
    }

    return out;
}
