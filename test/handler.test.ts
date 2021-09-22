/* eslint-disable import/no-named-as-default-member */
import { EventEmitter } from 'events';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { Status, ObservableResource, Subscriber, Subscription, EmitterResource, open, create } from '../src';

chai.use(chaiAsPromised);

function sleep(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, time);
    });
}

interface Timings {
    open: number;
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
            open: timings?.open || 250,
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

    public open(delay: number = this.__timings.open): Promise<void> {
        this.__status = 'opening';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'open';

                resolve();

                this.__emitter.emit('open');
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
            open: timings?.open || 250,
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

    public open(delay = this.__timings.open): Promise<void> {
        this.__status = 'opening';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'open';

                resolve();

                this.emit('open');
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
            const rh = await open(async () => {
                const mock = new ObservableResourceMock();

                await mock.open();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('open');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = await open(async () => {
                const mock = new ObservableResourceMock();
                await mock.open();

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

            expect(r2.status()).to.eq('open');
        });

        it('should allow to use custom closer', async () => {
            const spy = sinon.spy();
            const rh = await open(
                async () => {
                    const mock = new ObservableResourceMock();
                    await mock.open();

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

            expect(r.status()).to.eq('open');

            await rh.close();

            expect(r.status()).to.eq('closed');
            expect(spy.calledOnce).to.be.true;
        });
    });

    describe('Emitter', () => {
        it('should automatically connect', async () => {
            const rh = await open(async () => {
                const mock = new EmitterResourceMock();

                await mock.open();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('open');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = await open(async () => {
                const mock = new EmitterResourceMock();
                await mock.open();

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

            expect(r2.status()).to.eq('open');
        });

        it('should allow to use custom closer', async () => {
            const spy = sinon.spy();
            const rh = await open(
                async () => {
                    const mock = new EmitterResourceMock();
                    await mock.open();

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

            expect(r.status()).to.eq('open');

            await rh.close();

            expect(r.status()).to.eq('closed');
            expect(spy.calledOnce).to.be.true;
        });
    });

    describe('events', () => {
        describe('Observable', () => {
            it('should pass an error object on "failure"', async () => {
                const rh = await open(async () => {
                    const mock = new ObservableResourceMock();
                    await mock.open();

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
                const rh = await open(async () => {
                    const mock = new ObservableResourceMock();
                    await mock.open();

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

                await rh.open();

                expect(promise).to.be.fulfilled;
            });
        });

        describe('Emitter', () => {
            it('should pass an error object on "failure"', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock();
                    await mock.open();

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
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock();
                    await mock.open();

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

                await rh.open();

                expect(promise).to.be.fulfilled;
            });
        });
    });

    describe('onFailedAttempt', () => {
        it('should be called', async () => {
            const spy = sinon.spy();

            try {
                const rh = await open(() => Promise.reject(new Error()), {
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
            const promise = open(
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

    describe('.open', () => {
        context('when status is "open"', () => {
            it('should ignore the operation', async () => {
                const rh = create(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.open();

                    return mock;
                });

                await rh.open();

                await expect(rh.resource()).to.be.fulfilled;

                expect(rh.status).to.eq('open');

                await expect(rh.open()).to.be.fulfilled;

                await rh.close();
            });
        });

        context('when status is "opening"', () => {
            it('should wait and resolve a promise when a ResourceHandler gets into a finite state', async () => {
                const onOpening = sinon.spy();
                const stub = sinon.stub().callsFake(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.open(1000);

                    return mock;
                });
                const rh = create(stub);
                rh.subscribe('status', (status: Status) => {
                    if (status === 'opening') {
                        onOpening();
                    }
                });

                const original = rh.open();
                const follower1 = rh.open();
                const follower2 = rh.open();
                const follower3 = rh.open();

                await expect(Promise.all([original, follower1, follower2, follower3])).to.be.fulfilled;
                expect(stub.callCount).to.equal(1);
                expect(onOpening.callCount).to.equal(1);
            });
        });

        context('when status is "closing"', () => {
            it('should wait for ending of the current operation and open a new Resource', async () => {
                const onClosing = sinon.spy();
                const stub = sinon.stub().callsFake(async () => {
                    const mock = new EmitterResourceMock({
                        close: 1000,
                    });

                    await mock.open(100);

                    return mock;
                });
                const rh = create(stub);

                rh.subscribe('status', (status: Status) => {
                    if (status === 'closing') {
                        onClosing();
                    }
                });

                await rh.open();

                const closer = rh.close();
                const opener1 = rh.open();
                const opener2 = rh.open();
                const opener3 = rh.open();

                await expect(Promise.all([closer, opener1, opener2, opener3])).to.be.fulfilled;
                expect(stub.callCount).to.eq(2);
                expect(onClosing.callCount).to.eq(1);
                expect(rh.status).to.eql('open');
            });
        });

        context('when status is "closed"', () => {
            it('should open a new Resource', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.open(100);

                    return mock;
                });

                await expect(rh.resource()).to.be.fulfilled;
                await expect(rh.close()).to.be.fulfilled;

                expect(rh.status).to.eql('closed');

                await expect(rh.open()).to.be.fulfilled;

                expect(rh.status).to.eql('open');
            });
        });

        context('when status is "error"', () => {
            it('should try to re-open a Resource', async () => {
                let fail = true;
                const rh = create(
                    async () => {
                        if (fail) {
                            throw new Error('Voices are telling me "NO".');
                        }

                        const mock = new EmitterResourceMock({
                            error: 250,
                        });

                        await mock.open(100);

                        return mock;
                    },
                    {
                        retry: {
                            retries: 0,
                        },
                    },
                );

                await expect(rh.open()).to.fulfilled;
                expect(rh.status).to.eq('error');

                fail = false;
                await expect(rh.open()).to.be.fulfilled;
                await expect(rh.resource()).to.be.fulfilled;
            });
        });
    });

    describe('.close', () => {
        context('when status is "open"', () => {
            it('should set status of handler to "closed" and close underlying resource', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.open();

                    return mock;
                });

                await expect(rh.resource()).to.be.fulfilled;

                expect(rh.status).to.eq('open');

                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.resource()).to.been.rejected;
            });
        });

        context('when status is "opening"', () => {
            it('should set status of handler to "closing" and close underlying resource when it gets open', async () => {
                const rh = create(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.open(1000);

                    return mock;
                });

                rh.open();

                await expect(rh.close()).to.be.fulfilled;
                expect(rh.status).to.eq('closed');

                await expect(rh.resource()).to.been.rejected;
            });
        });

        context('when status is "closing"', () => {
            it('should ignore the requested operation and return a promise', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                        close: 500,
                    });

                    await mock.open(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;

                const original = rh.close();

                await expect(rh.close()).to.eventually.eq(false);

                await original;

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });

        context('when status is "closed"', () => {
            it('should ignore the requested operation and return a promise', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.open(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;
                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.close()).to.eventually.eq(false);

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });

        context('when status is "error"', () => {
            it('should ignore the requested operation and return a rejected promise', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock({
                        error: 250,
                    });

                    await mock.open(100);

                    return mock;
                });

                const onClose = sinon.stub(rh as any, '__onClose').callThrough();

                await expect(rh.resource()).to.be.fulfilled;
                await expect(rh.close()).to.be.fulfilled;
                await expect(rh.close()).to.eventually.eq(false);

                expect(onClose.callCount, 'onClose.callCount').to.eq(1);
            });
        });
    });

    describe('.resource', () => {
        context('when closed', () => {
            it('should reject a promise', async () => {
                const rh = await open(async () => {
                    const mock = new EmitterResourceMock();

                    await mock.open();

                    return mock;
                });

                await expect(rh.resource(), 'resolve resource').to.be.fulfilled;

                expect(rh.status).to.eq('open');

                await expect(rh.close(), 'close resource').to.be.fulfilled;
                await expect(rh.resource(), 'resolve resource').to.been.rejected;
            });
        });
    });
});
