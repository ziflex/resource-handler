/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable import/no-named-as-default-member */
import chai, { expect } from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import { toClosable } from '../src';

chai.use(chaiAsPromised);

describe('Resource', () => {
    describe('#toClosable', () => {
        context('when "key" is a string', () => {
            it('should create .close() method on a given object', async () => {
                const key = 'destroy';
                const obj = {
                    [key]: sinon.stub(),
                };

                const closable = toClosable(obj, key);

                expect(closable.close).to.be.a('function');

                await expect(closable.close()).to.be.fulfilled;

                expect(closable[key].calledOnce).to.be.true;
                expect(closable[key].getCall(0).args[0]).to.equal(obj);
            });
        });

        context('when "key" is a symbol', () => {
            it('should create .close() method on a given object', async () => {
                const key = Symbol('destroy');
                const obj = {
                    [key]: sinon.stub(),
                };

                const closable = toClosable(obj, key);

                expect(closable.close).to.be.a('function');

                await expect(closable.close()).to.be.fulfilled;

                expect(closable[key].calledOnce).to.be.true;
                expect(closable[key].getCall(0).args[0]).to.equal(obj);
            });
        });

        context('when "key" is a function', () => {
            it('should create .close() method on a given function', async () => {
                const fn = sinon.stub();
                const obj = {};

                const closable = toClosable(obj, fn);

                expect(closable.close).to.be.a('function').and.not.equal(fn);

                await expect(closable.close()).to.be.fulfilled;

                expect(fn.calledOnce).to.be.true;
                expect(fn.getCall(0).args[0]).to.equal(obj);
            });
        });

        it('should handle exceptions', async () => {
            const spy = sinon.spy();
            const obj = {};
            const fn = (input: any) => {
                spy(input);

                throw new Error('Boom!');
            };

            const closable = toClosable(obj, fn);

            return expect(closable.close()).to.be.rejected.then(() => {
                expect(spy.calledOnce).to.be.true;
                expect(spy.getCall(0).args[0]).to.equal(obj);
            });
        });

        context('when a closer returns Promise', () => {
            it('should wait for promise resolution ', async () => {
                const spy = sinon.spy();
                const obj = {};
                const fn = (input: any) => {
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            spy(input);
                            resolve();
                        }, 1000);
                    });
                };

                const closable = toClosable(obj, fn);

                await expect(closable.close()).to.be.fulfilled;
                expect(spy.calledOnce).to.be.true;
                expect(spy.getCall(0).args[0]).to.equal(obj);
            });

            it('should handle promise rejections', async () => {
                const spy = sinon.spy();
                const obj = {};
                const fn = (input: any) => {
                    return new Promise<void>((_, reject) => {
                        setTimeout(() => {
                            spy(input);
                            reject();
                        }, 1000);
                    });
                };

                const closable = toClosable(obj, fn);

                return expect(closable.close()).to.be.rejected.then(() => {
                    expect(spy.calledOnce).to.be.true;
                    expect(spy.getCall(0).args[0]).to.equal(obj);
                });
            });
        });

        context('when "input" is invalid', () => {
            it('throws on input being null', () => {
                const key = 'destroy';
                const obj = null;

                expect(() => toClosable(obj, key)).to.throw;
            });

            it('throws on input being undefined', () => {
                const key = 'destroy';
                const obj = undefined;

                expect(() => toClosable(obj, key)).to.throw;
            });
        });

        context('when "close" is invalid', () => {
            it('throws on key pointing to nothing', () => {
                const key = 'destroy';
                const obj = {};

                expect(() => toClosable(obj, key)).to.throw;
            });

            it('throws on key pointing to a non function property', () => {
                const key = 'destroy';
                const obj = {
                    [key]: 'foo',
                };

                expect(() => toClosable(obj, key)).to.throw;
            });

            it('throws on key being not a string or function', () => {
                const key = 1 as any;
                const obj = {
                    [key]: 'foo',
                };

                expect(() => toClosable(obj, key)).to.throw;
            });

            it('throws on key being null', () => {
                const key = null as any;
                const obj = {
                    [key]: 'foo',
                };

                expect(() => toClosable(obj, key)).to.throw;
            });

            it('throws on key being undefined', () => {
                const key = undefined as any;
                const obj = {
                    [key]: 'foo',
                };

                expect(() => toClosable(obj, key)).to.throw;
            });
        });
    });
});
