/**
 * Handler life cycle statuses.
 * "opening" - Resource is being created and not available yet.
 * "open" - Resource is created and available for use.
 * "closing" - Resource is being closed and not available anymore.
 * "closed" - Resource is closed and not avasilable anymore.
 * "error" - Resource creation is failed.
 */
export type Status = 'opening' | 'open' | 'closing' | 'closed' | 'error';

export interface StatusHolder {
    status: Status;
}

export function isAborted(holder: StatusHolder): boolean {
    return holder.status === 'closing' || holder.status === 'closed';
}

export function isTransient(holder: StatusHolder): boolean {
    return holder.status === 'closing' || holder.status === 'opening';
}

export function isFinal(holder: StatusHolder): boolean {
    return holder.status === 'open' || holder.status === 'closed';
}

export function isErrored(holder: StatusHolder): boolean {
    return holder.status === 'error';
}

export function isOpen(holder: StatusHolder): boolean {
    return holder.status === 'open';
}

export function isClosed(holder: StatusHolder): boolean {
    return holder.status === 'closed';
}
