# resource-handler
A thin wrapper around asynchronous resources

[![npm version](https://badge.fury.io/js/resource-handler.svg)](https://www.npmjs.com/package/resource-handler)
[![Actions Status](https://github.com/ziflex/resource-handler/workflows/Node%20CI/badge.svg)](https://github.com/ziflex/resource-handler/workflows/Node%20CI/badge.svg)

## Motivation
There are some scenarios when you need to monitor an async resource like a database connection that does not have auto reconnection functionality in order to recover it from a failure. This package provdes a lightwight wrapper around such resources that allows you to easily restore their state.

## Installation

```bash
npm i resource-handler
```

## API
You can find API [here](https://ziflex.github.io/resource-handler).

## Quick start

```typescript
import { ResourceHandler } from 'resource-handler';

const rh = new ResourceHandler(async () => {
    return connect();
});

const connection = await rh.resource();

await rh.close();
```

### Custom closer

```typescript
import { ResourceHandler } from 'resource-handler';

const rh = new ResourceHandler(async () => {
    return connect();
}, {
    closer: (resource) => resource.destroy()
});

const connection = await rh.resource();

await rh.close();
```

### Events proxying

```typescript
import { ResourceHandler } from 'resource-handler';

const rh = new ResourceHandler(async () => {
    return connect();
}, {
    events: [
        'foo'
    ]
});

rh.on('foo', () => console.log('bar'));

const connection = await rh.resource();

connection.emit('foo');

await rh.close();
```