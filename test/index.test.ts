import { EventEmitter } from 'events';
import { expect } from 'chai';
import { Status, Resource, ResourceHandler } from '../src';

class Mock extends EventEmitter implements Resource {
    private __status: Status;

    constructor() {
        super();

        this.__status = 'closed';
    }

    public status(): Status {
        return this.__status;
    }

    public error(err: Error): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.__status = 'error';

                resolve();

                this.emit('error', err);
            }, 100);
        });
    }

    public connect(): Promise<void> {
        this.__status = 'connecting';

        return new Promise((resolve) => {
            setTimeout(() => {
                this.__status = 'connected';

                resolve();

                this.emit('connect');
            }, 500);
        });
    }

    public close(): Promise<void> {
        this.__status = 'closing';

        return new Promise((resolve) => {
            setTimeout(() => {
                this.__status = 'closed';

                resolve();

                this.emit('close');
            }, 250);
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

        rh.on('failure', () => {
            console.log('caught failure');
        });

        const r = await rh.resource();

        await r.error(new Error('test'));

        expect(r.status()).to.eq('error');

        const r2 = await rh.resource();

        expect(r2.status()).to.eq('connected');
    });
});
