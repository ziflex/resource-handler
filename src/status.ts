/**
 * Handler life cycle statuses.
 */
export type Status = 'connecting' | 'connected' | 'error' | 'closing' | 'closed';

export function isAborted(status: Status): boolean {
    return status === 'closing' || status === 'closed';
}

export function isTransient(status: Status): boolean {
    return status === 'closing' || status === 'connecting';
}

export function isFinal(status: Status): boolean {
    return status === 'connected' || status === 'closed';
}

export function isErrored(status: Status): boolean {
    return status === 'error';
}

export function isReady(status: Status): boolean {
    return status === 'connected';
}

export function isClosed(status: Status): boolean {
    return status === 'closed';
}
