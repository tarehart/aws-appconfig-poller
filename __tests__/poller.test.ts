import { Poller } from '../src/poller.js';
import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata';
import { mockClient } from 'aws-sdk-client-mock';
import { Uint8ArrayBlobAdapter } from '@smithy/util-stream';

describe('Poller', () => {
  const appConfigClientMock = mockClient(AppConfigDataClient);

  const configValue = 'Some Configuration';

  appConfigClientMock.on(StartConfigurationSessionCommand).resolves({
    InitialConfigurationToken: 'initialToken',
  });

  appConfigClientMock.on(GetLatestConfigurationCommand).resolves({
    Configuration: Uint8ArrayBlobAdapter.fromString(configValue),
  });

  const dataClient = new AppConfigDataClient();

  let poller: Poller<string> | undefined;

  afterAll(() => {
    console.log('Stopping poller');
    poller.stop();
  });

  it('Polls', async () => {
    poller = new Poller({
      dataClient: dataClient,
      sessionConfig: {
        ApplicationIdentifier: 'MyApp',
        EnvironmentIdentifier: 'Test',
        ConfigurationProfileIdentifier: 'Config1',
      },
      logger: console.log,
    });

    await poller.start();
    const latest = poller.getConfigurationString();

    expect(latest.latestValue).toEqual(configValue);
    expect(latest.errorCausingStaleValue).toBeUndefined();
  });
});
