import { Main } from './lib/main';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

new Main(app, 'demo-pg-export-Stack', {
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  }
});

app.synth();