# aws-appconfig-poller

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
  // Turn the config string into an object however you like,
  // we'll cache the result (and also the raw string).
  configParser: (s: string) => JSON.parse(s),
});

try {
  await poller.start();
} catch (e) {
  // Handle any errors connecting to AppConfig
}
```

Fetch:

```typescript
// Instantly returns the cached configuration object that was
// polled in the background.
const configObject = poller.getConfigurationObject().latestValue;
```

## Error handling

A few things can go wrong when polling for AppConfig, such as:

- Permissions or networking error connecting to AWS.
- The config document could have been changed to something your configParser can't handle.

If there's an immediate connection problem during startup, and we're unable to retrieve the
configuration even once, we'll fail fast from the poller.start() function.

If we startup successfully, but some time later there are problems polling, we'll report
the error via the errorCausingStaleValue response attribute and continue polling in hopes
that the error resolves itself. You may wish to monitor or alarm on this situation because
your config object is potentially outdated.

```typescript
const { latestValue, errorCausingStaleValue } = poller.getConfigurationObject();
if (errorCausingStaleValue) {
  // Log some metric
}
```

## License

Licensed under the MIT license. See the [LICENSE](https://github.com/tarehart/aws-appconfig-poller/blob/main/LICENSE) file for details.

[gha-badge]: https://github.com/tarehart/aws-appconfig-poller/actions/workflows/nodejs.yml/badge.svg
[gha-ci]: https://github.com/tarehart/aws-appconfig-poller/actions/workflows/nodejs.yml
