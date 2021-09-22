/* eslint-disable @typescript-eslint/no-explicit-any */
import * as events from 'events';
import retry, { FailedAttemptError, AbortError } from 'p-retry';
import { ConnectionAbortError, ResourceClosedError, TerminationError, ResourceUnavailableError } from './errors';
import { Observable, Subscriber, Subscription, subscribe, AnyEvent } from './observable';
import { Resource, ResourceCloser, ResourceFactory } from './resource';
import { isAborted, isTransient, Status } from './status';
import { isClosed, isErrored, isReady } from '.';

const stateChangeEvt = Symbol('state');

/**
 * Deprecated events.
 * @deprecated
 */
export type DeprecatedEvent = 'open';

/**
 * Handler default events.
 */
export type Event = DeprecatedEvent | 'ready' | 'close' | 'status' | 'retry' | 'failure' | 'error';

/**
 * Event binding object describing how to transform event names during proxying.
 */
export interface EventBindingObject {
    /**
     * Event name to subscribe to.
     */
    from: string;

    /**
     * Event name to emit.
     */
    to: string;
}

/**
 * Event binding for proxying events.
 */
export type EventBinding = string | EventBindingObject;

/**
 * Handler reetry error.
 */
export type RetryError = FailedAttemptError;

/**
 * Handler retry options.
 */
export type RetryOptions = retry.Options;

/**
 * Handler options
 */
export interface Options<T extends Resource> {
    /**
     * Resource name
     */
    name?: string;

    /**
     * Function that is responsbile for resource closure.
     */
    closer?: ResourceCloser<T>;

    /**
     * Resource creation retry options.
     */
    retry?: RetryOptions;

    /**
     * A list of events that need to proxy.
     */
    events?: EventBinding[];
}
/**
 * ResourceHandler is a class that holds a resource and recreates it whenever it fails.
 * @param factory - Resource factory.
 * @param opts - Options.
 */
export class ResourceHandler<T extends Resource> implements Observable<Event | AnyEvent> {
    private readonly __factory: ResourceFactory<T>;
    private readonly __subscriptions: Subscription[];
    private readonly __emitter: events.EventEmitter & { emit(eventName: Event, ...args: any[]): boolean };
    private __resource?: T;
    private __err?: Error;
    private __status: Status;
    private __opts: Options<T>;

    constructor(factory: ResourceFactory<T>, opts?: Options<T>) {
        const onFailedAttempt = opts?.retry?.onFailedAttempt;

        this.__opts = {
            name: opts?.name || 'Resource',
            closer: opts?.closer,
            events: opts?.events,
            retry: {
                retries: opts?.retry?.retries || 10,
                minTimeout: opts?.retry?.minTimeout || 5000,
                maxTimeout: opts?.retry?.maxTimeout || Infinity,
                factor: opts?.retry?.factor || 2,
                randomize: opts?.retry?.randomize || false,
                onFailedAttempt: async (err: FailedAttemptError) => {
                    this.__onRetry(err);

                    if (typeof onFailedAttempt === 'function') {
                        return onFailedAttempt(err);
                    }
                },
            },
        };
        this.__factory = factory;
        this.__status = 'closed';
        this.__resource = undefined as any; // TS hack. We set in __connect
        this.__subscriptions = [];
        this.__emitter = new events.EventEmitter();
        // Supress Node failure
        // TODO: Make as an option?
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        this.__emitter.on('error', () => {});
    }

    /**
     * Returns the resource name
     */
    public get name(): string {
        return this.__opts.name || 'Resource';
    }

    /**
     * Returns the resource status
     */
    public get status(): Status {
        return this.__status;
    }

    /**
     * Returns the resource error, if there is any
     */
    public get error(): Error | undefined {
        return this.__err;
    }

    /**
     * Returns the resource value
     */
    public resource(): Promise<T> {
        if (isReady(this.__status)) {
            const res = this.__resource;

            if (res == null) {
                return Promise.reject(new ResourceUnavailableError(this.name));
            }

            return Promise.resolve(res);
        } else if (isErrored(this.__status)) {
            return Promise.reject(this.error || new ResourceUnavailableError(this.name));
        } else if (isClosed(this.__status)) {
            return Promise.reject(new ResourceClosedError(this.name));
        }

        // not ready yet
        return new Promise((resolve, reject) => {
            this.__emitter.once(stateChangeEvt, (status: Status, payload: Error | T | null) => {
                if (isReady(status)) {
                    if (payload != null) {
                        resolve(payload as T);
                    } else {
                        reject(new ResourceUnavailableError(this.name));
                    }
                } else if (isErrored(status)) {
                    reject(payload as Error);
                } else if (isClosed(status)) {
                    reject(new ResourceClosedError(this.name));
                }
            });
        });
    }

    /**
     * Creates a new resource value, if it does not exist
     */
    public async connect(): Promise<ResourceHandler<T>> {
        // only if it's in a channgin
        if (isTransient(this.__status) || isReady(this.__status)) {
            return this;
        }

        this.__setStatus('connecting');
        this.__err = undefined;
        this.__resource = undefined;

        try {
            const res = await retry(() => {
                if (isAborted(this.__status)) {
                    return Promise.reject(new AbortError(new ConnectionAbortError(this.name)));
                }

                return this.__factory();
            }, this.__opts.retry);

            // what if the operation has been terminated while we where connecting
            if (isAborted(this.__status)) {
                this.__onAbort();

                return this;
            }

            this.__onReady(res);
        } catch (err) {
            // all retries failed, cannot connect
            this.__onError(err as Error, true);
        }

        return this;
    }

    /**
     * Closes / destroys the resource value, if it exists
     */
    public async close(): Promise<ResourceHandler<T>> {
        if (this.__status === 'closed') {
            return Promise.reject(new ResourceClosedError(this.name));
        }

        // it's in the process of closing, nothing to do here
        if (this.__status === 'closing') {
            return new Promise((resolve) => {
                this.__emitter.once('close', () => resolve(this));
            });
        }

        // if it's connecting, we need to terminate it
        // by setting a new state
        if (this.__status === 'connecting') {
            this.__setStatus('closing');

            return this;
        }

        this.__setStatus('closing');

        const res = this.__resource;

        if (res != null) {
            await this.__closeResource(res);
        }

        this.__onClose();

        return this;
    }

    public subscribe(event: Event, subscriber: Subscriber): Subscription {
        this.__emitter.on(event, subscriber);

        return () => {
            this.__emitter.off(event, subscriber);
        };
    }

    private __subscribeToResource(res: T): void {
        this.__subscriptions.push(
            // the underlying resource failed
            // we will try to restore it, thus we just inform a user about this failure
            subscribe(res, 'error', (err) => {
                this.__onError(err, false);

                // close the failed resource
                this.__closeResource(res).finally(() => {
                    // and recreate it again
                    this.connect();
                });
            }),
        );

        this.__subscriptions.push(
            subscribe(res, 'close', () => {
                // if it's not triggered by us, then reconnect
                // the underlying resource must be closed by ResourceHandler only
                if (!isAborted(this.__status)) {
                    this.connect();
                }
            }),
        );

        if (Array.isArray(this.__opts.events)) {
            this.__opts.events.forEach((i) => {
                const from = typeof i === 'string' ? i : i.from;
                const to = typeof i === 'string' ? i : i.to;

                this.__subscriptions.push(
                    subscribe(res, from, (...args) => {
                        this.__emitter.emit(to, ...args);
                    }),
                );
            });
        }
    }

    private __unsubscribeFromResource(): void {
        this.__subscriptions.forEach((i) => {
            try {
                i();
            } finally {
            }
        });
        this.__subscriptions.length = 0;
    }

    private __onReady(res: T): void {
        this.__resource = res;
        this.__subscribeToResource(res);
        this.__setStatus('connected');

        this.__emitter.emit(stateChangeEvt, this.__status, res);
        this.__emitter.emit('ready', res);
        // @deprecated event
        this.__emitter.emit('open', res);
    }

    private __onRetry(reason: Error): void {
        this.__emitter.emit('retry', reason);
    }

    private __onError(reason: Error, fatal: boolean): void {
        this.__unsubscribeFromResource();

        this.__resource = undefined;
        this.__err = reason;
        this.__setStatus('error');

        if (fatal) {
            // failed to restore the resource
            // nothing we can do rather than notify about it
            this.__emitter.emit(stateChangeEvt, this.__status, reason);
            this.__emitter.emit('error', reason);
        } else {
            this.__emitter.emit('failure', reason);
        }
    }

    private __onAbort(): void {
        this.__onClose();
    }

    private __onClose(): void {
        this.__unsubscribeFromResource();

        this.__resource = undefined;
        this.__err = undefined;
        this.__setStatus('closed');

        this.__emitter.emit(stateChangeEvt, this.__status);
        this.__emitter.emit('close');
        this.__emitter.removeAllListeners();
    }

    private __setStatus(nextStatus: Status): void {
        this.__status = nextStatus;

        process.nextTick(() => {
            this.__emitter.emit('status', nextStatus);
        });
    }

    private async __closeResource(res: T): Promise<void> {
        try {
            if (typeof this.__opts.closer === 'function') {
                await Promise.resolve(this.__opts.closer(res));
            } else {
                await res.close();
            }
        } catch (e) {
            this.__emitter.emit('error', new TerminationError(this.name, e as Error));
        }
    }
}
