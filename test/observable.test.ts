/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable import/no-named-as-default-member */
import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon, { SinonSpy } from 'sinon';
import { isEmitter, subscribe, toObservable, isObservable } from '../src';

describe('Observables', () => {
    describe('#subscribe', () => {
        describe('When target is EventEmitter', () => {
            it('it should subscribe and return a subscription', () => {
                const emitter = new EventEmitter();
                const spy = sinon.spy();
                const sub = subscribe(emitter, 'test', spy);

                emitter.emit('test', 1, 1, 1);
                emitter.emit('test', 2, 2, 2);

                sub();

                emitter.emit('test', 3, 3, 3);

                expect(spy.callCount).to.eq(2);
                expect(spy.args[0][0]).to.eq(1);
                expect(spy.args[0][1]).to.eq(1);
                expect(spy.args[0][2]).to.eq(1);

                expect(spy.args[1][0]).to.eq(2);
                expect(spy.args[1][1]).to.eq(2);
                expect(spy.args[1][2]).to.eq(2);
            });
        });

        describe('When target is Observable', () => {
            it('it should subscribe and return a subscription', () => {
                const emitter = new EventEmitter();
                const spy = sinon.spy();
                const sub = subscribe(toObservable(emitter), 'test', spy);

                emitter.emit('test', 1, 1, 1);
                emitter.emit('test', 2, 2, 2);

                sub();

                emitter.emit('test', 3, 3, 3);

                expect(spy.callCount).to.eq(2);
                expect(spy.args[0][0]).to.eq(1);
                expect(spy.args[0][1]).to.eq(1);
                expect(spy.args[0][2]).to.eq(1);

                expect(spy.args[1][0]).to.eq(2);
                expect(spy.args[1][1]).to.eq(2);
                expect(spy.args[1][2]).to.eq(2);
            });
        });

        describe('When target is both EventEmitter and Observable', () => {
            it('should use EventEmitter interface', () => {
                const emitter: EventEmitter = new EventEmitter();
                const noop = () => {};
                (emitter as any).subscribe = sinon.stub().returns(noop);
                sinon.spy(emitter, 'on');
                sinon.spy(emitter, 'off');

                const sub = subscribe(emitter, 'test', noop);

                emitter.emit('test', 1, 1, 1);
                emitter.emit('test', 2, 2, 2);

                sub();

                emitter.emit('test', 3, 3, 3);

                expect((emitter.on as SinonSpy).calledOnce).to.be.true;
                expect((emitter.off as SinonSpy).calledOnce).to.be.true;
            });
        });
    });

    describe('#toObservable', () => {
        describe('When EventEmitter', () => {
            it('should create a new observable object', () => {
                const emitter = new EventEmitter();
                const observable = toObservable(emitter);

                expect(observable.subscribe).to.be.a('function');
            });
        });

        describe('When not EventEmitter', () => {
            it('should create a new observable object', () => {
                expect(() => {
                    toObservable({} as any);
                }).to.throw;
            });
        });
    });

    describe('#isEmitter', () => {
        describe('When EventEmitter', () => {
            it('should return "true"', () => {
                expect(isEmitter(new EventEmitter())).to.be.true;
            });
        });

        describe('When Observable', () => {
            it('should return "false"', () => {
                expect(isEmitter(toObservable(new EventEmitter()))).to.be.false;
            });
        });
    });

    describe('#isObservable', () => {
        describe('When Observable', () => {
            it('should return "true"', () => {
                expect(isObservable(toObservable(new EventEmitter()))).to.be.true;
            });
        });

        describe('When EventEmitter', () => {
            it('should return "false"', () => {
                expect(isObservable(new EventEmitter())).to.be.false;
            });
        });
    });
});
