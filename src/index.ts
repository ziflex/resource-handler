export * from './handler';
export * from './observable';
export * from './resource';
export * from './status';
export * from './errors';

import { ResourceHandler, Options } from './handler';
import { Resource, ResourceFactory } from './resource';

export function create<T extends Resource>(factory: ResourceFactory<T>, opts?: Options<T>): ResourceHandler<T> {
    return new ResourceHandler(factory, opts);
}

export function createAndConnect<T extends Resource>(
    factory: ResourceFactory<T>,
    opts?: Options<T>,
): Promise<ResourceHandler<T>> {
    return create(factory, opts).connect();
}
