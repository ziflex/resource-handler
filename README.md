# resource-handler

A thin wrapper around asynchronous resources

[![npm version](https://badge.fury.io/js/resource-handler.svg)](https://www.npmjs.com/package/resource-handler)
[![Actions Status](https://github.com/ziflex/resource-handler/workflows/Node%20CI/badge.svg)](https://github.com/ziflex/resource-handler/workflows/Node%20CI/badge.svg)

## Motivation

There are some scenarios when you need to monitor an async resource like a database connection that does not have auto reconnection functionality in order to recover it from a failure. This package provdes a lightwight wrapper around such resources that allows you to easily restore their state without any hussle.

## Installation

```bash
npm i resource-handler
```

## API

You can find API [here](https://ziflex.github.io/resource-handler).

## Quick start

```typescript
import * as amqp from 'amqplib';
import { create } from 'resource-handler';

const rh = create(async () => {
    return amqp.connect(opts);
});

await rh.open();

const connection = await rh.resource();

await rh.close();
```

With automatic opening:

```typescript
import * as amqp from 'amqplib';
import { open } from 'resource-handler';

const rh = await open(async () => {
    return amqp.connect(opts);
});

const connection = await rh.resource();

await rh.close();
```

### Retry options

By default, `resource-handler` uses default values for restoring a given resouce. You can tune it to meet your needs:

```typescript
import * as amqp from 'amqplib';
import { create } from 'resource-handler';

const rh = create(
    async () => {
        return amqp.connect(opts);
    },
    {
        retry: {
            retries: 5,
            minTimeout: 2000,
            maxTimeout: 10000,
            factor: 1.5,
            randomize: true,
        },
    },
);

await rh.open();

const connection = await rh.resource();

await rh.close();
```

### Custom closer

In case your resource has other than `.close` method for closing its operation, you can provide a custom closer function:

```typescript
import { create } from 'resource-handler';

const rh = create(
    async () => {
        return connect();
    },
    {
        closer: (resource) => resource.destroy(),
    },
);

await rh.open();

const connection = await rh.resource();

await rh.close();
```

### Events proxying

```typescript
import { create } from 'resource-handler';

const rh = create(
    async () => {
        return connect();
    },
    {
        events: ['foo'],
    },
);

await rh.open();

rh.on('foo', () => console.log('bar'));

const connection = await rh.resource();

connection.emit('foo');

await rh.close();
```

### Abrupt retries

```typescript
import { create } from 'resource-handler';

const rh = create(
    async () => {
        return connect();
    },
    {
        retry: {
            onFailedAttempt(err) {
                if (err.message === 'some error') {
                    throw new Error('Stop it!');
                }
            },
        },
    },
);

try {
    await rh.open();
    const res = await rh.resource();

    console.log("Successfuly open a resource");
} catch (e) {
    console.log("Failed to open a resource", e);
}

```
