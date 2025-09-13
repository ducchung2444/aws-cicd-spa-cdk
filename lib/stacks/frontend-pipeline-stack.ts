import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cp_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { DeployEnvEnum } from '../configs/types';
import { FE_CODE_CONNECTION_ARN } from '../configs/env';
import { DEPLOYMENT_ENV_CONFIG } from '../configs/env-configs';

export interface FrontendCicdStackProps extends cdk.StackProps {
    deploymentEnv: DeployEnvEnum;
}

export class FrontendCicdStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: FrontendCicdStackProps) {
        super(scope, id, props);

        const { deploymentEnv } = props;
        const { recordName, apexZone } = DEPLOYMENT_ENV_CONFIG.frontend[deploymentEnv];
        const fullDomain = `${recordName}.${apexZone}`;

        // 1) DNS: create a new public hosted zone (the domain's registrar must be updated with these NS records)
        const hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
            zoneName: apexZone,
        });

        // 2) Certificate (must be in us-east-1 for CloudFront). DNS validation via the hosted zone.
        const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
            domainName: fullDomain,
            hostedZone,
            region: 'us-east-1',
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        // 3) S3 bucket for built assets (private; only CloudFront OAC can read)
        const bucket = new s3.Bucket(this, 'AssetsBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
        });

        // 4) CloudFront OAC + Origin
        // const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
        //     signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
        //     originAccessControlName: `${deploymentEnv}-fe-cicd-${recordName}-oac`,
        // });

        // Prefer the API you cited; if your CDK lacks the helper, fallback to S3Origin with a cast.
        const s3Origin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(bucket, {
            // originAccessControl: oac,
            originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
        });

        // 5) CloudFront Distribution (SPA defaults + OAC)
        const distribution = new cloudfront.Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            domainNames: [fullDomain],
            certificate: certificate,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            defaultBehavior: {
                origin: s3Origin,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
            },
            errorResponses: [
                // SPA fallback for Vue router
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(1)
                },
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(1)
                },
            ],
        });

        // 6) Bucket policy to allow CloudFront (via OAC) to read objects
        bucket.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AllowCloudFrontServiceRead',
                actions: ['s3:GetObject'],
                resources: [bucket.arnForObjects('*')],
                principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
                conditions: {
                    StringEquals: { 'AWS:SourceArn': distribution.distributionArn },
                },
            }),
        );
        bucket.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AllowCloudFrontServiceList',
                actions: ['s3:ListBucket'],
                resources: [bucket.bucketArn],
                principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
                conditions: {
                    StringEquals: { 'AWS:SourceArn': distribution.distributionArn },
                },
            }),
        );

        // 7) Route 53 alias records to CloudFront
        new route53.ARecord(this, 'AliasARecord', {
            zone: hostedZone,
            recordName: recordName,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
            ttl: cdk.Duration.minutes(1),
        });
        new route53.AaaaRecord(this, 'AliasAAAARecord', {
            zone: hostedZone,
            recordName: recordName,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
            ttl: cdk.Duration.minutes(1),
        });

        // 8) CodePipeline: Source (CodeStar Connections) → Build/Deploy (CodeBuild)
        const sourceOutput = new codepipeline.Artifact('Source');
        const sourceAction = new cp_actions.CodeStarConnectionsSourceAction({
            actionName: 'GitHub',
            owner: DEPLOYMENT_ENV_CONFIG.frontend.owner,
            repo: DEPLOYMENT_ENV_CONFIG.frontend.repo,
            branch: DEPLOYMENT_ENV_CONFIG.frontend[deploymentEnv].branch,
            output: sourceOutput,
            connectionArn: FE_CODE_CONNECTION_ARN,
        });

        const codebuildRole = new iam.Role(this, 'CodeBuildActionRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        });
        bucket.grantReadWrite(codebuildRole);
        codebuildRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'cloudfront:CreateInvalidation'
            ],
            resources: ['*'],
        }));
        const project = new codebuild.PipelineProject(this, 'BuildAndDeploy', {
            projectName: `fe-cicd-${recordName}`,
            role: codebuildRole,
            description: 'Build Vue app, sync to S3, invalidate CloudFront',
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2023_5,
                computeType: codebuild.ComputeType.SMALL,
                privileged: false,
            },
            environmentVariables: {
                BUCKET_NAME: { value: bucket.bucketName },
                DISTRIBUTION_ID: { value: distribution.distributionId },
            },
            buildSpec: codebuild.BuildSpec.fromAsset('assets/build-spec/frontend.yml')
        });

        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            pipelineName: `fe-cicd-${recordName}`,
            crossAccountKeys: false,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        sourceAction
                    ]
                },
                {
                    stageName: 'Build_And_Deploy',
                    actions: [
                        new cp_actions.CodeBuildAction({
                            actionName: 'BuildAndDeploy',
                            project,
                            input: sourceOutput,
                        })
                    ],
                }
            ]
        });
        pipeline.artifactBucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

        // Useful outputs
        new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
        new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.domainName });
        new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
        new cdk.CfnOutput(this, 'HostedZoneId', { value: hostedZone.hostedZoneId });
        new cdk.CfnOutput(this, 'HostedZoneNameServers', {
            value: cdk.Fn.join(', ', hostedZone.hostedZoneNameServers ?? []),
            description: 'Update these NS at your domain registrar to delegate DNS to Route 53.',
        });
        new cdk.CfnOutput(this, 'SiteURL', { value: `https://${fullDomain}` });
    }
}
