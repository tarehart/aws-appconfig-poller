import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  GetLatestConfigurationCommandOutput,
  StartConfigurationSessionCommand,
  StartConfigurationSessionCommandInput,
} from '@aws-sdk/client-appconfigdata';

export interface PollerConfig<T> {
  dataClient: AppConfigDataClient;
  sessionConfig: StartConfigurationSessionCommandInput;
  pollIntervalSeconds?: number;
  configParser?: (s: string) => T;
  logger?: (s: string, obj?: unknown) => void;
}

export interface ConfigStore<T> {
  latestValue?: T;
  lastFreshTime?: Date;
  errorCausingStaleValue?: Error;
  versionLabel?: string;
}

type PollingPhase = 'ready' | 'starting' | 'active' | 'stopped';

/**
 * Starts polling immediately upon construction.
 */
export class Poller<T> {
  private readonly DEFAULT_POLL_INTERVAL_SECONDS = 30;

  private readonly config: PollerConfig<T>;

  private pollingPhase: PollingPhase = 'ready';

  private configurationToken?: string;

  private configStringStore: ConfigStore<string>;
  private configObjectStore: ConfigStore<T>;

  private timeoutHandle?: NodeJS.Timeout;

  constructor(config: PollerConfig<T>) {
    this.config = config;

    this.configStringStore = {};
    this.configObjectStore = {};
  }

  public async start(): Promise<void> {
    if (this.pollingPhase != 'ready') {
      throw new Error('Can only call start() once for an instance of Poller!');
    }
    this.pollingPhase = 'starting';
    await this.startPolling();
    this.pollingPhase = 'active';
  }

  public stop(): void {
    this.pollingPhase = 'stopped';
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }
  }

  /**
   * This will instantly return a cached value. Make sure you've awaited the
   * completion of the start() call before calling this method.
   *
   * @returns The latest configuration in string format, along with some metadata.
   */
  public getConfigurationString(): ConfigStore<string> {
    if (this.pollingPhase != 'active') {
      throw new Error('Poller is not active!');
    }
    return this.configStringStore;
  }

  /**
   * This returns a version of the config that's been parsed according to the
   * configParser passed into this class. It's possible that this value is
   * more stale than getConfigurationString, in the case where a new value
   * retrieved from AppConfig is malformed and the transformer has been failing.
   *
   * This will instantly return a cached value. Make sure you've awaited the
   * completion of the start() call before calling this method.
   *
   * @returns The latest configuration in object format, along with some metadata.
   */
  public getConfigurationObject(): ConfigStore<T> {
    if (this.pollingPhase != 'active') {
      throw new Error('Poller is not active!');
    }
    return this.configObjectStore;
  }

  private async startPolling(): Promise<void> {
    const { dataClient, sessionConfig } = this.config;

    const startCommand = new StartConfigurationSessionCommand(sessionConfig);
    const result = await dataClient.send(startCommand);

    if (!result.InitialConfigurationToken) {
      throw new Error(
        'Missing configuration token from AppConfig StartConfigurationSession response',
      );
    }

    this.configurationToken = result.InitialConfigurationToken;

    await this.fetchLatestConfiguration();
  }

  private async fetchLatestConfiguration(): Promise<void> {
    const { dataClient, logger } = this.config;

    const getCommand = new GetLatestConfigurationCommand({
      ConfigurationToken: this.configurationToken,
    });

    let awsSuggestedIntervalSeconds: number | undefined;

    try {
      const getResponse = await dataClient.send(getCommand);
      awsSuggestedIntervalSeconds = getResponse.NextPollIntervalInSeconds;

      this.processGetResponse(getResponse);
    } catch (e) {
      this.configStringStore.errorCausingStaleValue = e;
      this.configObjectStore.errorCausingStaleValue = e;

      if (this.pollingPhase === 'starting') {
        // If we're part of the initial startup sequence, fail fast.
        throw e;
      }

      logger?.(
        'Values have gone stale, will wait and then start a new configuration session in response to error:',
        e,
      );

      this.timeoutHandle = setTimeout(() => {
        logger?.(
          'Starting new configuration session in hopes of recovering...',
        );
        this.startPolling();
      }, this.config.pollIntervalSeconds * 1000);

      return;
    }

    const nextIntervalInSeconds = this.getNextIntervalInSeconds(
      awsSuggestedIntervalSeconds,
    );

    this.timeoutHandle = setTimeout(() => {
      this.fetchLatestConfiguration();
    }, nextIntervalInSeconds * 1000);
  }

  private processGetResponse(
    getResponse: GetLatestConfigurationCommandOutput,
  ): void {
    const { logger } = this.config;

    if (getResponse.NextPollConfigurationToken) {
      this.configurationToken = getResponse.NextPollConfigurationToken;
    }

    try {
      const stringValue = getResponse.Configuration?.transformToString();

      if (stringValue) {
        this.cacheNewValue(stringValue, getResponse.VersionLabel);
      } else {
        // When the configuration in the getResponse is empty, that means the configuration is
        // unchanged from the last time we polled.
        // https://docs.aws.amazon.com/appconfig/2019-10-09/APIReference/API_appconfigdata_GetLatestConfiguration.html
        this.configStringStore.lastFreshTime = new Date();
        this.configObjectStore.lastFreshTime = new Date();
      }
    } catch (e) {
      this.configStringStore.errorCausingStaleValue = e;
      this.configObjectStore.errorCausingStaleValue = e;
      logger?.('Config string and object have gone stale:', e);
    }
  }

  private cacheNewValue(stringValue: string, versionLabel?: string): void {
    const { logger, configParser } = this.config;

    this.configStringStore.latestValue = stringValue;
    this.configStringStore.lastFreshTime = new Date();
    this.configStringStore.versionLabel = versionLabel;
    this.configStringStore.errorCausingStaleValue = undefined;

    if (configParser) {
      try {
        this.configObjectStore.latestValue = configParser(
          this.configStringStore.latestValue,
        );
        this.configObjectStore.lastFreshTime = new Date();
        this.configObjectStore.versionLabel = versionLabel;
        this.configObjectStore.errorCausingStaleValue = undefined;
      } catch (e) {
        this.configObjectStore.errorCausingStaleValue = e;
        logger?.('Config object could not be parsed:', e);
      }
    }
  }

  private getNextIntervalInSeconds(awsSuggestedSeconds?: number): number {
    return (
      this.config.pollIntervalSeconds ||
      awsSuggestedSeconds ||
      this.DEFAULT_POLL_INTERVAL_SECONDS
    );
  }
}
