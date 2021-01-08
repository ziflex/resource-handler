import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon from 'sinon';
import { Status, ObservableResource, ResourceHandler, Subscriber, Subscription, EmitterResource } from '../src';

function sleep(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, time);
    });
}

class ObservableResourceMock implements ObservableResource {
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

class EmitterResourceMock extends EventEmitter implements EmitterResource {
    private __status: Status;

    constructor() {
        super();
        this.__status = 'closed';
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
            }, 50);
        });
    }

    public connect(): Promise<void> {
        this.__status = 'connecting';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'connected';

                resolve();

                this.emit('connect');
            }, 250);
        });
    }

    public close(): Promise<void> {
        this.__status = 'closing';

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.__status = 'closed';

                resolve();

                this.emit('close');
            }, 100);
        });
    }
}

describe('Resource handler', () => {
    describe('Observable', () => {
        it('should automatically connect', async () => {
            const rh = new ResourceHandler(async () => {
                const mock = new ObservableResourceMock();

                await mock.connect();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('connected');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = new ResourceHandler(async () => {
                const mock = new ObservableResourceMock();
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
            const rh = new ResourceHandler(async () => {
                const mock = new EmitterResourceMock();

                await mock.connect();

                return mock;
            });

            const r = await rh.resource();

            expect(r.status()).to.eq('connected');
        });

        it('should automatically recover from disconnect', async () => {
            const rh = new ResourceHandler(async () => {
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
            const rh = new ResourceHandler(
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
                const rh = new ResourceHandler(async () => {
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
                const rh = new ResourceHandler(async () => {
                    const mock = new ObservableResourceMock();
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

        describe('Emitter', () => {
            it('should pass an error object on "failure"', async () => {
                const rh = new ResourceHandler(async () => {
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
                const rh = new ResourceHandler(async () => {
                    const mock = new EmitterResourceMock();
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

    describe('onFailedAttempt', () => {
        it('should be called', async () => {
            debugger;
            const spy = sinon.spy();

            try {
                const rh = new ResourceHandler(() => Promise.reject(new Error()), {
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
            const rh = new ResourceHandler(
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

            try {
                await rh.resource();
            } catch {
            } finally {
                expect(spy.callCount).to.eq(2);
            }
        }).timeout(10000);
    });
});
