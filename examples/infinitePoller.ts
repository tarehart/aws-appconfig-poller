import { Poller } from '../src/poller.js';
import { AppConfigDataClient } from '@aws-sdk/client-appconfigdata';
import { parse } from 'yaml';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { AwsCredentialIdentity, Provider } from '@smithy/types';

/**
 * This is a made-up format, corresponding to an AppConfig profile
 * that I created in my personal AWS account for testing.
 */
interface SampleFormat {
  Content: {
    description: string;
    advantages: string[];
  };
}

/**
 * This helps me avoid mentioning my AWS account id in a public repo.
 * https://stackoverflow.com/a/74546015
 *
 * Normally there's no need for this.
 */
const getAWSAccountId = async (): Promise<string> => {
  const response = await new STSClient().send(new GetCallerIdentityCommand({}));
  return String(response.Account);
};

/**
 * I'm using a temporary credentials provider (based on STS assumeRole)
 * to give confidence that the credentials will refresh themselves after
 * the duration expires.
 */
const getCredentialsProvider = (
  awsAccountId: string,
): Provider<AwsCredentialIdentity> => {
  return fromTemporaryCredentials({
    params: {
      // This is a role I created in my personal AWS account for testing.
      RoleArn: `arn:aws:iam::${awsAccountId}:role/AppConfigReader`,
      DurationSeconds: 900,
    },
  });
};

const dataClient = new AppConfigDataClient({
  credentials: getCredentialsProvider(await getAWSAccountId()),
});

const poller = new Poller<SampleFormat>({
  dataClient: dataClient,
  sessionConfig: {
    // These refer to an AppConfig profile I created in my personal
    // AWS account for testing.
    ApplicationIdentifier: 'PollerTest',
    EnvironmentIdentifier: 'Live',
    ConfigurationProfileIdentifier: 'YamlTest',
  },
  configParser: (s): SampleFormat => parse(s),
  logger: console.log,
  pollIntervalSeconds: 60,
});

const { isInitiallySuccessful, error } = await poller.start();

if (!isInitiallySuccessful) {
  poller.stop();
  throw new Error('Startup failed', { cause: error });
}

console.log('Connection succeeded at:', new Date());

// Normally you would not use setInterval in your app, this is just to help us
// periodically log the state of the configuration object to prove it's working.
setInterval(() => {
  const obj = poller.getConfigurationObject();
  console.log('Current config entry', obj);
}, 1000 * 5);

// This will run forever until you manually terminate it.
// Normally you would call poller.stop() if you want the program to exit.
