#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FrontendCicdStack } from '../lib/stacks/frontend-pipeline-stack';
import { ACCOUNT, REGION } from '../lib/configs/env';
import { DeployEnvEnum } from '../lib/configs/types';
import { FrontendSimpleStack } from '../lib/stacks/frontend-simple-stack';


const app = new cdk.App();
new FrontendCicdStack(app, 'frontend-cicd-pipeline-stack', {
    env: { account: ACCOUNT, region: REGION },
    deploymentEnv: DeployEnvEnum.PROD,
});

new FrontendSimpleStack(app, 'frontend-simple-stack', {
    env: { account: ACCOUNT, region: REGION },
});
