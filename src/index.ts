/* eslint-disable @typescript-eslint/no-explicit-any */
import * as events from 'events';
// eslint-disable-next-line import/default
import retry, { FailedAttemptError, AbortError } from 'p-retry';
import { TimeoutsOptions } from 'retry';

/**
 * Handler life cycle statuses.
 */
export type Status = 'connecting' | 'connected' | 'error' | 'closing' | 'closed';

/**
 * Handler default events.
 */
export type Event = 'open' | 'close' | 'error' | 'status' | 'retry';

/**
 * Handler reetry error.
 */
export type RetryError = FailedAttemptError;

/**
 * Handler retry options.
 */
export type RetryOptions = TimeoutsOptions;

/**
 * Resource is a closable and observable object that needs to be handled.
 */
export interface Resource extends events.EventEmitter {
    close(): Promise<void>;
}

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
    name: string;

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
    events?: string[];
}
/**
 * ResourceHandler is a class that holds an async resource and recreates it wenevr it fails
 * @param factory - Resource factory.
 * @param opts - Options.
 */
export class ResourceHandler<T extends Resource> extends events.EventEmitter {
    private __resource: Promise<T | null>;
    private __factory: ResourceFactory<T>;
    private __err?: Error;
    private __status: Status;
    private __opts: Options<T>;

    constructor(factory: ResourceFactory<T>, opts?: Options<T>) {
        super();

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
        this.__connect(true);
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

        res.removeAllListeners();

        if (this.__opts.closer) {
            return this.__opts.closer(res);
        }

        return res.close();
    }

    private __subscribe(res: T): void {
        res.once('error', (err) => {
            res.removeAllListeners();
            this.__err = err;
            this.__setStatus('error');
            this.__connect();

            this.emit('error', err);
        });

        res.once('close', () => {
            res.removeAllListeners();
            this.__setToClose();
        });

        if (Array.isArray(this.__opts.events)) {
            this.__opts.events.forEach((i) => {
                res.on(i, (...args) => {
                    this.emit(i, ...args);
                });
            });
        }
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
            Object.assign(
                {
                    onFailedAttempt: (err: FailedAttemptError) => {
                        this.emit('retry', err);
                    },
                },
                this.__opts.retry,
            ),
        )
            .then((res: T) => {
                if (this.__status === 'closing') {
                    this.__setToClose();

                    return Promise.reject(new Error(`${this.__opts.name} is closed`));
                }

                this.__subscribe(res);
                this.__setStatus('connected');

                this.emit('open');

                return res;
            })
            .catch((err) => {
                this.__err = err;
                this.__setStatus('error');

                this.emit('failure', err);

                return Promise.resolve(null);
            });
    }

    private __setToClose(): void {
        this.__resource = Promise.reject(new Error(`${this.__opts.name} is closed`));
        this.__err = undefined;
        this.__setStatus('closed');

        this.emit('close');
        this.removeAllListeners();
    }

    private __setStatus(nextStatus: Status): void {
        this.__status = nextStatus;

        process.nextTick(() => {
            this.emit('status', nextStatus);
        });
    }
}
