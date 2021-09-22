import { Lock as Mutex, ILock } from 'lock';

const defaultKey = '@mutex';

export type Release = () => void;

export class Lock {
    private readonly __mutex: ILock;

    constructor() {
        this.__mutex = Mutex();
    }

    public async acquire(key: string = defaultKey): Promise<Release> {
        return new Promise((release) => {
            this.__mutex(key, (releaser) => {
                release(releaser());
            });
        });
    }
}
