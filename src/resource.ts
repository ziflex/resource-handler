import { Observable, Emitter } from './observable';

/**
 * A closable object that supports an async closing operation.
 */
export interface Closable {
    close(): Promise<void>;
}

/**
 * Resource that implements Observable interface.
 */
export interface ObservableResource extends Observable, Closable {}

/**
 * Resource that implements Emitter interface.
 */
export interface EmitterResource extends Emitter, Closable {}

/**
 * Resource is an object that needs to be handled.
 */
export type Resource = ObservableResource | EmitterResource;
