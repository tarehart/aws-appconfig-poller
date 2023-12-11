# aws-appconfig-poller

[![Build Status - GitHub Actions][gha-badge]][gha-ci]

A wrapper around @aws-sdk/client-appconfigdata to provide background polling and caching.

Although AWS seems to recommend their [simplified retrieval methods](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-retrieving-simplified-methods.html) for fetching AppConfig, i.e. running an agent in a separate process, you may prefer to use this library:

- You don't need to set up a lambda extension.
- You easily get parity between your local development server and prod.
- The parsed version of your config is conveniently cached.
- You get convenient reporting of transient errors while the library works in the background to recover.

## Usage

Initialize:

```typescript
import { AppConfigDataClient } from '@aws-sdk/client-appconfigdata';
import { Poller } from 'aws-appconfig-poller';

const dataClient = new AppConfigDataClient({
  // Set up credentials, region, etc, as necessary.
  credentials: undefined,
});

const poller = new Poller({
  dataClient: dataClient,
  sessionConfig: {
    // This configuration will be specific to your app
    ApplicationIdentifier: 'MyApp',
    EnvironmentIdentifier: 'Test',
    ConfigurationProfileIdentifier: 'Config1',
  },
  logger: console.log,
  // Turn the config string into an object however you like,
  // we'll cache the result (and also the raw string).
  configParser: (s: string) => JSON.parse(s),
});

// We avoid bubbling up exceptions, and keep trying in the background
// even if we were  not initially successful.
const { isInitiallySuccessful, error } = await poller.start();
```

Fetch:

```typescript
// Instantly returns the cached configuration object that was
// polled in the background.
const { latestValue } = poller.getConfigurationObject();
```

For full working code, see examples/infinitePoller.ts.

## Error handling

A few things can go wrong when polling for AppConfig, such as:

- Permissions or networking error connecting to AWS.
- The config document could have been changed to something your configParser can't handle.

If there's an immediate connection problem during startup, and we're unable to retrieve the
configuration even once, we'll report it in the response from poller.start(), and continue
attempting to connect in the background.

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
