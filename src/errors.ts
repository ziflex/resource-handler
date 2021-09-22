export class ResourceError extends Error {
    public static toResourceName(name: string): string {
        return name || 'Resource';
    }

    constructor(public readonly resource: string, message: string, public readonly cause?: Error) {
        super(message);
    }
}

export class ResourceUnavailableError extends ResourceError {
    constructor(resource: string) {
        const name = ResourceError.toResourceName(resource);
        super(name, `${name} is not available`);
    }
}

export class ResourceClosedError extends ResourceError {
    constructor(resource: string) {
        const name = ResourceError.toResourceName(resource);
        super(name, `${name} is closed`);
    }
}

export class ConnectionAbortError extends ResourceError {
    constructor(resource: string) {
        const name = ResourceError.toResourceName(resource);
        super(name, `${name} connection is aborted`);
    }
}

export class TerminationError extends ResourceError {
    constructor(resource: string, cause: Error) {
        const name = ResourceError.toResourceName(resource);
        super(name, `Failed to close ${name.toLocaleLowerCase()}`, cause);
    }
}
