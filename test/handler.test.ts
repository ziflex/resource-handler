import { EventEmitter } from 'events';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import {
    Status,
    ObservableResource,
    Subscriber,
    Subscription,
    EmitterResource,
    ResourceClosedError,
    createAndConnect,
    create,
} from '../src';

chai.use(chaiAsPromised);

function sleep(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, time);
    });
}

interface Timings {
    connect: number;
    close: number;
    error: number;
}

class ObservableResourceMock implements ObservableResource {
    private readonly __emitter: EventEmitter;
    private __status: Status;
    private readonly __timings: Timings;

    constructor(timings?: Partial<Timings>) {
        this.__emitter = new EventEmitter();
        this.__status = 'closed';
        this.__timings = {
            connect: timings?.connect || 250,
            close: timings?.close || 100,
            error: timings?.error || 50,
        };
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

    public error(err: Error, delay: number = this.__timings.error): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'error';

                resolve();

                this.__emitter.emit('error', err);
            }, delay);
        });
    }

    public connect(delay: number = this.__timings.connect): Promise<void> {
        this.__status = 'connecting';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'connected';

                resolve();

                this.__emitter.emit('connect');
            }, delay);
        });
    }

    public close(delay: number = this.__timings.close): Promise<void> {
        this.__status = 'closing';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'closed';

                resolve();

                this.__emitter.emit('close');
            }, delay);
        });
    }
}

class EmitterResourceMock extends EventEmitter implements EmitterResource {
    private __status: Status;
    private __timings: Timings;

    constructor(timings?: Partial<Timings>) {
        super();
        this.__status = 'closed';
        this.__timings = {
            connect: timings?.connect || 250,
            close: timings?.close || 100,
            error: timings?.error || 50,
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

                this.emit('error', err);
            }, this.__timings.error);
        });
    }

    public connect(delay = this.__timings.connect): Promise<void> {
        this.__status = 'connecting';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'connected';

                resolve();

                this.emit('connect');
            }, delay);
        });
    }

    public close(delay = this.__timings.close): Promise<void> {
        this.__status = 'closing';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'closed';

                resolve();

                this.emit('close');
            }, delay);
        });
    }
}

describe('Resource handler', () => {
    describe('Observable', () => {
        it('should automatically connect', async () => {
            const rh = await createAndConnect(async () => {
                const mock = new ObservableResourceMock();

                await mock.connect();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('connected');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = await createAndConnect(async () => {
                const mock = new ObservableResourceMock();
                await mock.connect();

                return mock;
            });

            const onFailure = sinon.spy();

            rh.subscribe('failure', onFailure);

            const r = await rh.resource();

            await r.error(new Error('test'));

            await sleep(100);

            expect(r.status()).to.eq('closed');

            const r2 = await rh.resource();

            await sleep(500);

            expect(r2.status()).to.eq('connected');
        });

        it('should allow to use custom closer', async () => {
            const spy = sinon.spy();
            const rh = await createAndConnect(
                async () => {
                    const mock = new ObservableResourceMock();
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
    });

    describe('Emitter', () => {
        it('should automatically connect', async () => {
            const rh = await createAndConnect(async () => {
                const mock = new EmitterResourceMock();

                await mock.connect();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('connected');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = await createAndConnect(async () => {
                const mock = new EmitterResourceMock();
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
            const rh = await createAndConnect(
                async () => {
                    const mock = new EmitterResourceMock();
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
    });

    describe('events', () => {
        describe('Observable', () => {
            it('should pass an error object on "failure"', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new ObservableResourceMock();
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
                const rh = await createAndConnect(async () => {
                    const mock = new ObservableResourceMock();
                    await mock.connect();

                    return mock;
                });

                const r1 = await rh.resource();
                await rh.close();

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

                await rh.connect();

                expect(promise).to.be.fulfilled;
            });
        });

        describe('Emitter', () => {
            it('should pass an error object on "failure"', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock();
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
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock();
                    await mock.connect();

                    return mock;
                });

                const r1 = await rh.resource();
                await rh.close();
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

                await rh.connect();

                expect(promise).to.be.fulfilled;
            });
        });
    });

    describe('onFailedAttempt', () => {
        it('should be called', async () => {
            const spy = sinon.spy();

            try {
                const rh = await createAndConnect(() => Promise.reject(new Error()), {
                    retry: {
                        onFailedAttempt: spy,
                        retries: 2,
                        factor: 1,
                        forever: false,
                        randomize: false,
                        minTimeout: 100,
                        maxTimeout: 500,
                    },
                });

                await rh.resource();
            } catch {
            } finally {
                expect(spy.callCount).to.eq(3);
            }
        }).timeout(10000);

        it('should abort if a given callback throws an error', async () => {
            const errors = [new Error('1'), new Error('2'), new Error('3'), new Error('4'), new Error('5')];
            const spy = sinon.spy();
            const promise = createAndConnect(
                async () => {
                    const err = errors.shift();

                    if (err) {
                        return Promise.reject(err);
                    }

                    return new ObservableResourceMock();
                },
                {
                    retry: {
                        retries: 4,
                        factor: 1,
                        forever: false,
                        randomize: false,
                        minTimeout: 100,
                        maxTimeout: 500,
                        onFailedAttempt(err) {
                            spy(err);

                            if (err.message === '2') {
                                throw new Error('Test');
                            }
                        },
                    },
                },
            );

            await expect(promise).to.be.not.rejected;
            expect(spy.callCount).to.eq(2);
        }).timeout(20000);
    });

    describe('.close', () => {
        context('when status is "connected"', () => {
            it('should set status of handler to "closed" and close underlying resource', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.connect();

                    return mock;
                });

                await expect(rh.resource()).to.be.fulfilled;

                expect(rh.status).to.eq('connected');

                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.resource()).to.been.rejected;
            });
        });

        context('when status is "connecting"', () => {
            it('should set status of handler to "closing" and close underlying resource when it gets connected', async () => {
                const rh = await create(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.connect(1000);

                    return mock;
                });

                const onConnected = rh.connect();

                expect(rh.status).to.eq('connecting');
                await expect(rh.close()).to.be.fulfilled;

                await onConnected;

                await expect(rh.resource()).to.been.rejected;
            });
        });

        context('when status is "closing"', () => {
            it('should ignore the requested operation and return a promise', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.connect(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;

                await expect(Promise.all([rh.close(), rh.close()])).to.be.fulfilled;

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });

        context('when status is "closed"', () => {
            it('should ignore the requested operation and return a rejected promise', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.connect(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;
                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.close()).to.be.rejectedWith(ResourceClosedError);

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });

        context('when status is "error"', () => {
            it('should ignore the requested operation and return a rejected promise', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.connect(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;
                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.close()).to.be.rejectedWith(ResourceClosedError);

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });
    });

    describe('.resource', () => {
        context('when closed', () => {
            it('should reject a promise', async () => {
                const rh = await createAndConnect(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.connect();

                    return mock;
                });

                await expect(rh.resource(), 'resolve resource').to.be.fulfilled;

                expect(rh.status).to.eq('connected');

                await expect(rh.close(), 'close resource').to.be.fulfilled;
                await expect(rh.resource(), 'resolve resource').to.been.rejected;
            });
        });
    });
});
