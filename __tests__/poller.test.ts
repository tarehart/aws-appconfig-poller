import { Poller, PollerConfig } from '../src/poller.js';
import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata';
import { AwsError, mockClient } from 'aws-sdk-client-mock';
import { Uint8ArrayBlobAdapter } from '@smithy/util-stream';

const standardConfig: Omit<PollerConfig<string>, 'dataClient'> = {
  sessionConfig: {
    ApplicationIdentifier: 'MyApp',
    EnvironmentIdentifier: 'Test',
    ConfigurationProfileIdentifier: 'Config1',
  },
  configParser: (s: string) => s.substring(1),
  pollIntervalSeconds: 1,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Poller', () => {
  const appConfigClientMock = mockClient(AppConfigDataClient);

  let poller: Poller<string> | undefined;

  afterEach(() => {
    poller.stop();
    appConfigClientMock.reset();
  });

  it('Polls', async () => {
    const configValue = 'Some Configuration';

    appConfigClientMock.on(StartConfigurationSessionCommand).resolves({
      InitialConfigurationToken: 'initialToken',
    });

    appConfigClientMock.on(GetLatestConfigurationCommand).resolves({
      Configuration: Uint8ArrayBlobAdapter.fromString(configValue),
    });

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
    });

    const { isInitiallySuccessful, error } = await poller.start();

    expect(isInitiallySuccessful).toBeTruthy();
    expect(error).toBeUndefined();

    const latest = poller.getConfigurationString();

    expect(latest.latestValue).toEqual(configValue);
    expect(latest.errorCausingStaleValue).toBeUndefined();
  });

  it('Reports error if startConfigurationSession fails', async () => {
    appConfigClientMock.on(StartConfigurationSessionCommand).rejects({
      message: 'Failed to start session',
    } as AwsError);

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
    });

    const { isInitiallySuccessful, error } = await poller.start();

    expect(isInitiallySuccessful).toBeFalsy();
    expect(error).toBeDefined();
    expect(error.message).toBe('Failed to start session');
  });

  it('Reports error if first getLatest fails', async () => {
    appConfigClientMock.on(StartConfigurationSessionCommand).resolves({
      InitialConfigurationToken: 'initialToken',
    });

    appConfigClientMock.on(GetLatestConfigurationCommand).rejects({
      message: 'Failed to get latest',
    });

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
    });

    const { isInitiallySuccessful, error } = await poller.start();

    expect(isInitiallySuccessful).toBeFalsy();
    expect(error).toBeDefined();
    expect(error.message).toBe('Failed to get latest');
  });

  it('Continues polling if first getLatest string cannot be parsed', async () => {
    appConfigClientMock.on(StartConfigurationSessionCommand).resolves({
      InitialConfigurationToken: 'initialToken',
    });

    appConfigClientMock.on(GetLatestConfigurationCommand).resolves({
      Configuration: Uint8ArrayBlobAdapter.fromString('abc'),
    });

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
      configParser(s): string {
        throw new Error('bad string ' + s);
      },
    });

    await poller.start();

    const str = poller.getConfigurationString();
    expect(str.latestValue).toBeDefined();

    const obj = poller.getConfigurationObject();
    expect(obj.latestValue).toBeUndefined();
    expect(obj.errorCausingStaleValue).toBeDefined();
  });

  it('Attempts session restart if second fetch fails', async () => {
    const configValue = 'worked once';
    const configValue2 = 'worked again';

    appConfigClientMock.on(StartConfigurationSessionCommand).resolves({
      InitialConfigurationToken: 'initialToken',
    });

    appConfigClientMock
      .on(GetLatestConfigurationCommand)
      .resolvesOnce({
        Configuration: Uint8ArrayBlobAdapter.fromString(configValue),
      })
      .rejectsOnce({
        message: 'Failed to get latest',
      })
      .resolves({
        Configuration: Uint8ArrayBlobAdapter.fromString(configValue2),
      });

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
    });

    await poller.start();
    const latest = poller.getConfigurationString();

    expect(latest.latestValue).toEqual(configValue);
    expect(latest.errorCausingStaleValue).toBeUndefined();

    await wait(standardConfig.pollIntervalSeconds * 1000 + 100);

    const updated = poller.getConfigurationObject();
    expect(updated.errorCausingStaleValue).toBeDefined();
    expect(updated.latestValue).toEqual(
      standardConfig.configParser(configValue),
    );

    await wait(standardConfig.pollIntervalSeconds * 1000 + 100);

    const updatedAgain = poller.getConfigurationObject();
    expect(updatedAgain.errorCausingStaleValue).toBeUndefined();
    expect(updatedAgain.latestValue).toEqual(
      standardConfig.configParser(configValue2),
    );
  });

  it('Retries start session if first one fails', async () => {
    const configValue = 'worked once';

    appConfigClientMock.on(StartConfigurationSessionCommand)
      .rejectsOnce({
        message: 'Failed to start',
      })
      .resolves({
        InitialConfigurationToken: 'initialToken',
      });

    appConfigClientMock
      .on(GetLatestConfigurationCommand)
      .resolves({
        Configuration: Uint8ArrayBlobAdapter.fromString(configValue),
      });

    const dataClient = new AppConfigDataClient();

    poller = new Poller({
      dataClient: dataClient,
      ...standardConfig,
    });

    const initialResponse = await poller.start();
    expect(initialResponse.error).toBeDefined();
    expect(initialResponse.isInitiallySuccessful).toBeFalsy();

    const latest = poller.getConfigurationString();

    expect(latest.latestValue).toBeUndefined();
    expect(latest.errorCausingStaleValue).toBeUndefined();

    await wait(standardConfig.pollIntervalSeconds * 1000 + 100);

    const updated = poller.getConfigurationObject();
    expect(updated.errorCausingStaleValue).toBeUndefined();
    expect(updated.latestValue).toEqual(
      standardConfig.configParser(configValue),
    );
  });
});
