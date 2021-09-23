/* eslint-disable @typescript-eslint/no-explicit-any */
import * as events from 'events';
import retry, { FailedAttemptError, AbortError } from 'p-retry';
import { Lock } from './lock';
import { OpenAbortedError, ResourceClosedError, CloseError, ResourceUnavailableError } from './errors';
import { Observable, Subscriber, Subscription, subscribe, AnyEvent } from './observable';
import { Resource, ResourceCloser, ResourceFactory } from './resource';
import { isErrored, isAborted, Status, isClosed, isOpen } from './status';

/**
 * Handler default events.
 * "open" - Resource is available for consumption.
 * "close" - Resource is closed.
 * "status" - ResourceHandler changed its Status.
 * "retry" - ResourceHandler is retrying to create a resource.
 * "failure" - Resource has failed by emitting "error" event.
 * "error" - Creation of Resource failed and no further attempts will be made.
 */
export type Event = 'open' | 'close' | 'status' | 'retry' | 'failure' | 'error';

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
     * Automatically connect when resource is requested.
     * @default false
     */
    autoConnect?: boolean;

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
    private __lock: Lock;

    constructor(factory: ResourceFactory<T>, opts?: Options<T>) {
        const onFailedAttempt = opts?.retry?.onFailedAttempt;

        this.__opts = {
            name: opts?.name || 'Resource',
            autoConnect: typeof opts?.autoConnect === 'boolean' ? opts?.autoConnect : false,
            closer: opts?.closer,
            events: opts?.events,
            retry: {
                retries: typeof opts?.retry?.retries === 'number' ? opts?.retry?.retries : 10,
                minTimeout: typeof opts?.retry?.minTimeout === 'number' ? opts?.retry?.minTimeout : 5000,
                maxTimeout: typeof opts?.retry?.maxTimeout === 'number' ? opts?.retry?.maxTimeout : Infinity,
                factor: typeof opts?.retry?.factor === 'number' ? opts?.retry?.factor : 2,
                randomize: typeof opts?.retry?.randomize === 'boolean' ? opts?.retry?.randomize : false,
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
        this.__resource = undefined;
        this.__subscriptions = [];
        this.__lock = new Lock();
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
    public async resource(): Promise<T> {
        const release = await this.__lock.acquire();

        try {
            if (isOpen(this)) {
                const res = this.__resource;

                if (res != null) {
                    return res;
                }

                return Promise.reject(new ResourceUnavailableError(this.name));
            }

            if (isClosed(this)) {
                return Promise.reject(new ResourceClosedError(this.name));
            }
        } catch (e) {
        } finally {
            release();
        }

        return Promise.reject(new ResourceUnavailableError(this.name));
    }

    /**
     * Creates a new resource value, if it does not exist
     * @returns 'true' if the operation succeeded, otherwise 'false'.
     */
    public async open(): Promise<boolean> {
        const release = await this.__lock.acquire();

        const out = await this.__open();

        release();

        return out;
    }

    /**
     * Closes / destroys the resource value, if it exists
     * @returns 'true' if the operation succeeded, otherwise 'false'.
     */
    public async close(): Promise<boolean> {
        const release = await this.__lock.acquire();

        try {
            if (isClosed(this)) {
                return false;
            }

            if (isErrored(this)) {
                return false;
            }

            this.__setStatus('closing');

            const res = this.__resource;

            if (res != null) {
                await this.__closeResource(res);
            }

            this.__onClose();
        } catch (err) {
        } finally {
            release();
        }

        return true;
    }

    public subscribe(event: Event, subscriber: Subscriber): Subscription {
        this.__emitter.on(event, subscriber);

        return () => {
            this.__emitter.off(event, subscriber);
        };
    }

    private async __open(): Promise<boolean> {
        try {
            // already open
            if (isOpen(this)) {
                return true;
            }

            this.__setStatus('opening');
            this.__err = undefined;
            this.__resource = undefined;

            const res = await retry(() => {
                if (isAborted(this)) {
                    return Promise.reject(new AbortError(new OpenAbortedError(this.name)));
                }

                return this.__factory();
            }, this.__opts.retry);

            // what if the operation has been terminated while we were openning the resource
            if (isAborted(this)) {
                this.__onAbort();

                return false;
            }

            this.__onOpen(res);
        } catch (err) {
            // all retries failed, cannot open
            this.__onError(err as Error, true);

            return false;
        }

        return true;
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
                    this.open();
                });
            }),
        );

        this.__subscriptions.push(
            subscribe(res, 'close', () => {
                // if it's not triggered by us, then re-open
                // the underlying resource must be closed by ResourceHandler only
                if (!isAborted(this)) {
                    this.__onClose();
                    this.open();
                }
            }),
        );

        if (Array.isArray(this.__opts.events)) {
            this.__opts.events.forEach((i) => {
                const from = typeof i === 'string' ? i : i.from;
                const to = typeof i === 'string' ? i : i.to;

                this.__subscriptions.push(
                    subscribe(res, from, (...args) => {
                        this.__emit(to, ...args);
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

    private __onOpen(res: T): void {
        this.__resource = res;
        this.__subscribeToResource(res);
        this.__setStatus('open');

        this.__emit('open', res);
    }

    private __onRetry(reason: Error): void {
        this.__emit('retry', reason);
    }

    private __onError(reason: Error, fatal: boolean): void {
        this.__unsubscribeFromResource();

        this.__resource = undefined;
        this.__err = reason;
        this.__setStatus('error');

        if (fatal) {
            // failed to restore the resource
            // nothing we can do rather than notify about it
            this.__emit('error', reason);
        } else {
            this.__emit('failure', reason);
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

        this.__emit('close');
    }

    private __setStatus(nextStatus: Status): void {
        const prevStatus = this.__status;
        this.__status = nextStatus;

        this.__emit('status', nextStatus, prevStatus);
    }

    private __emit(event: any, arg1?: any, arg2?: any): void {
        process.nextTick(() => {
            this.__emitter.emit(event, arg1, arg2);
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
            this.__emit('error', new CloseError(this.name, e as Error));
        }
    }
}
