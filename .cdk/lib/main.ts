import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_rds as rds, Tags } from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_secretsmanager as secretsManager } from 'aws-cdk-lib';
import { aws_ssm as ssm } from 'aws-cdk-lib';
import { aws_kms as kms } from 'aws-cdk-lib';
import { Lambda as nrbLambda, Stacks } from "@nrbdigital/nrb-cdk-library";
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { aws_lambda as lambda } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { VpnConnection } from 'aws-cdk-lib/aws-ec2';


export class Main extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        Tags.of(this).add('app', 'demo-pg-export');
        const vpc = new ec2.Vpc(this, 'demo-pg-export-vpc', {
            cidr: '10.0.0.0/16',
            natGateways: 0,
            maxAzs: 3,
            subnetConfiguration: [
                {
                    name: 'public-subnet-1',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'isolated-subnet-1',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 28,
                },
            ],
        });

        /* Secrets Manager Endpoint */
        vpc.addInterfaceEndpoint('sm', {
            service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER
        });

        /* RDS Data API Endpoint */
        vpc.addInterfaceEndpoint('rds_data', {
            service: ec2.InterfaceVpcEndpointAwsService.RDS_DATA
        });

        vpc.addGatewayEndpoint('s3-gateway', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }]
        });

        let lambdaToRDSProxyGroup = new ec2.SecurityGroup(this, 'Lambda to RDS Proxy Connection', {
            vpc
        });

        const parameterGroup = rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', "default.aurora-postgresql13");

        const s3Bucket = new s3.Bucket(this, `demo-pg-export-data`, {
            bucketName: `demo-pg-export-data`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: false,
            encryption: s3.BucketEncryption.S3_MANAGED,
        });

        this.exportValue(s3Bucket.bucketName, {
            name: 'demo-pg-export-data-bucket-name',
        });

        const runtimeLayer = nrbLambda.NodeModuleLayer(this, `${this.stackName}-runtimelayer`, getSrcPath());

        const exportToS3Lambda = exportToS3(this, {
            functionOpts: {
                name: "export-to-s3",
                networking: {
                    fromLookup: false,
                    subnets: vpc.isolatedSubnets,
                    vpc: vpc,
                },
                environment: {

                    S3_BUCKET: s3Bucket.bucketName,
                },
                src: getSrcPath(),
                securityGroups: [lambdaToRDSProxyGroup],
                runtimeLayer: runtimeLayer,
                handler: "handlers.exportToS3",
            }
        });

        grantAccessToS3(s3Bucket, exportToS3Lambda, true);

        const importFromS3Lambda = importFromS3(this, {
            functionOpts: {
                name: "import-from-s3",
                networking: {
                    fromLookup: false,
                    subnets: vpc.isolatedSubnets,
                    vpc: vpc,
                },
                environment: {
                    S3_BUCKET: s3Bucket.bucketName,
                },
                src: getSrcPath(),
                securityGroups: [lambdaToRDSProxyGroup],
                runtimeLayer: runtimeLayer,
                handler: "handlers.importFromS3",
            }
        });

        grantAccessToS3(s3Bucket, importFromS3Lambda, true);

        ['from', 'to'].forEach(env => {
            const sg = new ec2.SecurityGroup(this, `eth-gedin-${env}-DatabaseSecurityGroup`, {
                vpc: vpc,
                description: `Security group for the eth-gedin ${env} database`,
                allowAllOutbound: true,
            })

            sg.addIngressRule(sg, ec2.Port.tcp(5432), 'allow db connection');
            sg.addIngressRule(lambdaToRDSProxyGroup, ec2.Port.tcp(5432), 'allow lambda connection');

            const databaseCredentialsSecret = new secretsManager.Secret(this, `${env}-DBCredentialsSecret`, {
                secretName: `demo-pg-export-${env}-credentials`,
                generateSecretString: {
                    secretStringTemplate: JSON.stringify({
                        username: 'postgres',
                    }),
                    excludePunctuation: true,
                    includeSpace: false,
                    generateStringKey: 'password'
                }
            });

            new ssm.StringParameter(this, `${env}-DBCredentialsArn`, {
                parameterName: `demo-pg-export-${env}-credentials-arn`,
                stringValue: databaseCredentialsSecret.secretArn,
            });

            const key = new kms.Key(this, `Database${env}KMSKey`, {
                removalPolicy: cdk.RemovalPolicy.RETAIN,
                pendingWindow: cdk.Duration.days(30),
                alias: `alias/demo-pg-export-${env}-db-key`,
                description: `KMS key for encrypting the demo-pg-export-${env} database`,
                enableKeyRotation: false,
            });
            const dbName = `demoPGExport${this.capitalize(env)}`;
            const cluster = new rds.DatabaseCluster(this, `Database${env}`, {
                clusterIdentifier: `demo-pg-export-${env}-cluster`,
                engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
                parameterGroup: parameterGroup,
                instanceProps: {

                    vpc: vpc,
                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    },
                    instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MEDIUM),
                    securityGroups: [
                        sg
                    ]

                },
                defaultDatabaseName: dbName,
                instanceIdentifierBase: `demo-pg-export-${env}`,
                deletionProtection: false, //TODO: To remove
                instances: 1,
                credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
                storageEncryptionKey: key,
                s3ExportBuckets: env === 'from' ? [s3Bucket] : undefined,
                s3ImportBuckets: env === 'to' ? [s3Bucket] : undefined,
            });

            const proxy = cluster.addProxy(`demo-pg-export-${env}-database-proxy`, {
                secrets: [databaseCredentialsSecret],
                debugLogging: true,
                vpc: vpc,
                securityGroups: [sg],
            });

            Tags.of(cluster).add('env', env);

            if (env === 'from') {
                exportToS3Lambda.addEnvironment('PROXY_ENDPOINT', proxy.endpoint);
                exportToS3Lambda.addEnvironment('RDS_SECRET_NAME', databaseCredentialsSecret.secretName);
                databaseCredentialsSecret.grantRead(exportToS3Lambda);
            } else {
                importFromS3Lambda.addEnvironment('PROXY_ENDPOINT', proxy.endpoint);
                importFromS3Lambda.addEnvironment('RDS_SECRET_NAME', databaseCredentialsSecret.secretName);
                databaseCredentialsSecret.grantRead(importFromS3Lambda);
            }

            new cdk.CfnOutput(this, `Secret Name ${env}`, { value: databaseCredentialsSecret.secretName });
            new cdk.CfnOutput(this, `DB Endpoint ${env}`, { value: cluster.clusterEndpoint.hostname });
            new cdk.CfnOutput(this, `DBName ${env}`, { value: dbName });

        });






    }
    private capitalize(s: string): string {
        if (typeof s !== 'string') return ''
        return s.charAt(0).toUpperCase() + s.slice(1)
    }
}

function grantAccessToS3(bucket: s3.IBucket, lambda: lambda.Function, rw: boolean = false) {
    if (rw) {
        bucket.grantReadWrite(lambda);
    } else {
        bucket.grantRead(lambda);
    }
}

function getSrcPath(project: string = "") {
    return join(process.cwd(), "..", project);
}

function exportToS3(stack: cdk.Stack, props: cdk.StackProps & Stacks.IStackProps): cdk.aws_lambda_nodejs.NodejsFunction {
    if (!props.functionOpts.roleArn) {
        const lambdaRole = new iam.Role(stack, `${props.functionOpts.name}-LambdaExecutionRole`, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ]
        });
        props.functionOpts.roleArn = lambdaRole.roleArn;
    }

    const lambdaFn = nrbLambda.NodeJsFunction(stack, props.functionOpts)
    return lambdaFn;
}
function importFromS3(stack: cdk.Stack, props: cdk.StackProps & Stacks.IStackProps): cdk.aws_lambda_nodejs.NodejsFunction {
    if (!props.functionOpts.roleArn) {
        const lambdaRole = new iam.Role(stack, `${props.functionOpts.name}-LambdaExecutionRole`, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ]
        });
        props.functionOpts.roleArn = lambdaRole.roleArn;
    }

    const lambdaFn = nrbLambda.NodeJsFunction(stack, props.functionOpts)
    return lambdaFn;
}