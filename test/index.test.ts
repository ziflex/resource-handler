import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon from 'sinon';
import { Status, Resource, ResourceHandler, Subscriber, Subscription } from '../src';

function sleep(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, time);
    });
}

class Mock implements Resource {
    private readonly __emitter: EventEmitter;
    private __status: Status;

    constructor() {
        this.__emitter = new EventEmitter();
        this.__status = 'closed';
    }

    public subscribe(event: string, subscriber: Subscriber): Subscription {
        this.__emitter.on(event, subscriber);

        return () => {
            this.__emitter.off(event, subscriber);
        };
    }

    public status(): Status {
        return this.__status;
    }

    public error(err: Error): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'error';

                resolve();

                this.__emitter.emit('error', err);
            }, 50);
        });
    }

    public connect(): Promise<void> {
        this.__status = 'connecting';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'connected';

                resolve();

                this.__emitter.emit('connect');
            }, 250);
        });
    }

    public close(): Promise<void> {
        this.__status = 'closing';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'closed';

                resolve();

                this.__emitter.emit('close');
            }, 100);
        });
    }
}

describe('Resource handlers', () => {
    it('should automatically connect', async () => {
        const rh = new ResourceHandler(async () => {
            const mock = new Mock();

            await mock.connect();

            return mock;
        });

        const r = await rh.resource();

        expect(r.status()).to.eq('connected');
    });

    it('should automatically recover from disconnect', async () => {
        const rh = new ResourceHandler(async () => {
            const mock = new Mock();
            await mock.connect();

            return mock;
        });

        rh.subscribe('failure', () => {
            console.log('caught failure');
        });

        const r = await rh.resource();

        await r.error(new Error('test'));

        await sleep(100);

        expect(r.status()).to.eq('closed');

        const r2 = await rh.resource();

        expect(r2.status()).to.eq('connected');
    });

    it('should allow to use custom closer', async () => {
        const spy = sinon.spy();
        const rh = new ResourceHandler(
            async () => {
                const mock = new Mock();
                await mock.connect();

                return mock;
            },
            {
                closer: (i) => {
                    spy();
                    return i.close();
                },
            },
        );

        const r = await rh.resource();

        expect(r.status()).to.eq('connected');

        await rh.close();

        expect(r.status()).to.eq('closed');
        expect(spy.calledOnce).to.be.true;
    });

    describe('events', () => {
        it('should pass an error object on "failure"', async () => {
            const rh = new ResourceHandler(async () => {
                const mock = new Mock();
                await mock.connect();

                return mock;
            });

            const r1 = await rh.resource();
            const promise = new Promise<void>((resolve, reject) => {
                rh.subscribe('failure', (err: Error) => {
                    try {
                        expect(err.message).to.eq('test');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            await r1.error(new Error('test'));

            return promise;
        });

        it('should pass a new resource on "open"', async () => {
            const rh = new ResourceHandler(async () => {
                const mock = new Mock();
                await mock.connect();

                return mock;
            });

            const r1 = await rh.resource();
            const promise = new Promise<void>((resolve, reject) => {
                rh.subscribe('open', (nextRes) => {
                    try {
                        expect(r1).to.not.equal(nextRes);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            await r1.error(new Error('test'));

            await rh.resource();

            return promise;
        });
    });
});
