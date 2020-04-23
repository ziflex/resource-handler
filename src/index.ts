/* eslint-disable @typescript-eslint/no-explicit-any */
import * as events from 'events';
// eslint-disable-next-line import/default
import retry, { FailedAttemptError, AbortError } from 'p-retry';
import { TimeoutsOptions } from 'retry';

export enum Status {
    Connecting = 'connecting',
    Connected = 'connected',
    Error = 'error',
    Closing = 'closing',
    Closed = 'closed',
}

export type RetryError = FailedAttemptError;

export type RetryOptions = TimeoutsOptions;

export type Event = 'open' | 'close' | 'error' | 'status' | 'retry';

export interface Resource extends events.EventEmitter {
    close(): Promise<void>;
}

export type ResourceFactory<T extends Resource> = () => Promise<T>;

export type ResourceCloser<T extends Resource> = (res: T) => Promise<void>;

export interface Options<T extends Resource> {
    name: string;
    closer?: ResourceCloser<T>;
    retry?: RetryOptions;
    eventBindings?: string[];
}

export class Handler<T extends Resource> extends events.EventEmitter {
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
            eventBindings: opts?.eventBindings,
            retry: {
                retries: opts?.retry?.retries || 10,
                minTimeout: opts?.retry?.minTimeout || 5000,
                maxTimeout: opts?.retry?.maxTimeout || Infinity,
                factor: opts?.retry?.factor || 2,
                randomize: opts?.retry?.randomize || false,
            },
        };
        this.__factory = factory;
        this.__status = Status.Connecting;
        this.__resource = undefined as any; // TS hack. We set in __connect
        this.__connect(true);
    }

    public get status(): Status {
        return this.__status;
    }

    public get error(): Error | undefined {
        return this.__err;
    }

    public async resource(): Promise<T> {
        const res = await this.__resource;

        if (!res) {
            return Promise.reject(new Error(`${this.__opts} is not available`));
        }

        return res;
    }

    public async connect(): Promise<void> {
        this.__connect();

        await this.__resource;
    }

    public async close(): Promise<void> {
        if (this.__status === Status.Closed) {
            return Promise.reject(new Error(`${this.__opts.name} is closed`));
        }

        if (this.__status === Status.Connecting) {
            this.__setStatus(Status.Closing);

            return Promise.resolve();
        }

        this.__setStatus(Status.Closed);

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
            this.__setStatus(Status.Error);
            this.__connect();

            this.emit('error', err);
        });

        res.once('close', () => {
            res.removeAllListeners();
            this.__setToClose();
        });

        if (Array.isArray(this.__opts.eventBindings)) {
            this.__opts.eventBindings.forEach((i) => {
                res.on(i, (...args) => {
                    this.emit(i, ...args);
                });
            });
        }
    }

    private __connect(force = false): void {
        if (!force) {
            if (
                this.__status === Status.Connecting ||
                this.__status === Status.Connected ||
                this.__status === Status.Closing ||
                this.__status === Status.Closed
            ) {
                return;
            }
        }

        this.__setStatus(Status.Connecting);
        this.__err = undefined;
        this.__resource = retry(
            () => {
                if (this.__status === Status.Closing) {
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
                if (this.__status === Status.Closing) {
                    this.__setToClose();

                    return Promise.reject(new Error(`${this.__opts.name} is closed`));
                }

                this.__subscribe(res);
                this.__setStatus(Status.Connected);

                this.emit('open');

                return res;
            })
            .catch((err) => {
                this.__err = err;
                this.__setStatus(Status.Error);

                this.emit('failure', err);

                return Promise.resolve(null);
            });
    }

    private __setToClose(): void {
        this.__resource = Promise.reject(new Error(`${this.__opts.name} is closed`));
        this.__err = undefined;
        this.__setStatus(Status.Closed);

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
