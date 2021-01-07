/* eslint-disable @typescript-eslint/no-explicit-any */
import * as events from 'events';
import retry, { FailedAttemptError, AbortError } from 'p-retry';
import { TimeoutsOptions } from 'retry';
import { Observable, Subscriber, Subscription, subscribe } from './observable';
import { Closable, Resource } from './resource';

/**
 * Handler life cycle statuses.
 */
export type Status = 'connecting' | 'connected' | 'error' | 'closing' | 'closed';

/**
 * Handler default events.
 */
export type Event = 'open' | 'close' | 'error' | 'status' | 'retry';

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
export type RetryOptions = TimeoutsOptions;

/**
 * Resource closer is a function that creates a new resource.
 */
export type ResourceFactory<T extends Resource> = () => Promise<T>;

/**
 * Resource closer is a function that receives a current resource and closes it.
 */
export type ResourceCloser<T extends Resource> = (res: T) => Promise<void>;

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
export class ResourceHandler<T extends Resource> implements Observable, Closable {
    private readonly __factory: ResourceFactory<T>;
    private readonly __subscriptions: Subscription[];
    private readonly __emitter: events.EventEmitter;
    private __resource: Promise<T | null>;
    private __err?: Error;
    private __status: Status;
    private __opts: Options<T>;

    constructor(factory: ResourceFactory<T>, opts?: Options<T>) {
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
            },
        };
        this.__factory = factory;
        this.__status = 'connecting';
        this.__resource = undefined as any; // TS hack. We set in __connect
        this.__subscriptions = [];
        this.__emitter = new events.EventEmitter();
        this.__connect(true);
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
        const res = await this.__resource;

        if (!res) {
            return Promise.reject(new Error(`${this.__opts} is not available`));
        }

        return res;
    }

    /**
     * Creates a new resource value, if it does not exist
     */
    public async connect(): Promise<void> {
        this.__connect();

        await this.__resource;
    }

    /**
     * Closes / destroys the resource value, if it exists
     */
    public async close(): Promise<void> {
        if (this.__status === 'closed') {
            return Promise.reject(new Error(`${this.__opts.name} is closed`));
        }

        if (this.__status === 'connecting') {
            this.__setStatus('closing');

            return Promise.resolve();
        }

        this.__setStatus('closed');

        const res = await this.__resource;

        if (res == null) {
            return Promise.resolve();
        }

        this.__unsubscribeFromResource();

        return this.__closeResource(res);
    }

    public subscribe(event: string, subscriber: Subscriber): Subscription {
        this.__emitter.on(event, subscriber);

        return () => {
            this.__emitter.off(event, subscriber);
        };
    }

    private __subscribeToResource(res: T): void {
        this.__subscriptions.push(
            subscribe(res, 'error', (err) => {
                this.__unsubscribeFromResource();
                this.__err = err;
                this.__setStatus('error');

                // close resource if needed
                this.__closeResource(res).finally(() => {
                    this.__connect();

                    // the underlying resource failed
                    // we will try to restore it, thus we just inform a user about this failure
                    this.__emitter.emit('failure', err);
                });
            }),
        );

        this.__subscriptions.push(
            subscribe(res, 'close', () => {
                this.__unsubscribeFromResource();
                this.__setToClose();
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
        this.__subscriptions.forEach((i) => i());
        this.__subscriptions.length = 0;
    }

    private __connect(force = false): void {
        if (!force) {
            if (
                this.__status === 'connecting' ||
                this.__status === 'connected' ||
                this.__status === 'closing' ||
                this.__status === 'closed'
            ) {
                return;
            }
        }

        this.__setStatus('connecting');
        this.__err = undefined;
        this.__resource = retry(
            () => {
                if (this.__status === 'closing') {
                    this.__setToClose();

                    throw new AbortError(`Connection is aborted`);
                }

                return this.__factory();
            },
            Object.assign({}, this.__opts.retry, {
                onFailedAttempt: (err: FailedAttemptError) => {
                    this.__emitter.emit('retry', err);
                },
            }),
        )
            .then((res: T) => {
                if (this.__status === 'closing') {
                    this.__setToClose();

                    return Promise.reject(new Error(`${this.__opts.name} is closed`));
                }

                this.__subscribeToResource(res);
                this.__setStatus('connected');

                this.__emitter.emit('open', res);

                return res;
            })
            .catch((err) => {
                this.__err = err;
                this.__setStatus('error');

                // failed to restore the resource
                // nothing we can do rather than notify about it
                this.__emitter.emit('error', err);

                return Promise.resolve(null);
            });
    }

    private __setToClose(): void {
        this.__resource = Promise.reject(new Error(`${this.__opts.name} is closed`));
        this.__err = undefined;
        this.__setStatus('closed');

        this.__emitter.emit('close');
        this.__emitter.removeAllListeners();
    }

    private __setStatus(nextStatus: Status): void {
        this.__status = nextStatus;

        process.nextTick(() => {
            this.__emitter.emit('status', nextStatus);
        });
    }

    private __closeResource(res: T): Promise<void> {
        if (typeof this.__opts.closer === 'function') {
            return this.__opts.closer(res);
        }

        return res.close();
    }
}
