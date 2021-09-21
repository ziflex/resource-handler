import { Observable, Emitter, AnyEvent } from './observable';

/**
 * A closable object that supports an async closing operation.
 */
export interface Closable {
    close(): Promise<void>;
}

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
