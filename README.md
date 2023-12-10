# aws-appconfig-poller

[![TypeScript version][ts-badge]][typescript-5-1]
[![Node.js version][nodejs-badge]][nodejs]
[![Build Status - GitHub Actions][gha-badge]][gha-ci]

A wrapper around @aws-sdk/client-appconfigdata to provide background polling and caching.

## Usage

Initialize:

```typescript
const poller = new Poller({
  dataClient: dataClient,
  sessionConfig: {
    ApplicationIdentifier: 'MyApp',
    EnvironmentIdentifier: 'Test',
    ConfigurationProfileIdentifier: 'Config1',
  },
  logger: console.log,
});

await poller.start();
```

Fetch:

```typescript
const value = poller.getConfigurationString().latestValue;
```

## License

Licensed under the MIT license. See the [LICENSE](https://github.com/tarehart/aws-appconfig-poller/blob/main/LICENSE) file for details.
