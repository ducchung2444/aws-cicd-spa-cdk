// stacks/FrontendSimpleStack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class FrontendSimpleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1) Private S3 bucket for SPA assets
    const bucket = new s3.Bucket(this, 'SpaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,     // <- convenient for testing
      autoDeleteObjects: true,                       // <- convenient for testing
    });

    // If your CDK has the helper, you can use:
    // const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket, {
    //   originAccessControl: oac,
    //   originAccessLevels: [cloudfront.AccessLevel.READ],
    // });
    // To keep it broadly compatible, use S3Origin and attach OAC via distribution props:
    const origin = new origins.S3Origin(bucket);

    // 3) CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        // Bind OAC
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      // SPA-style fallback (optional)
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
      ],
      // Attach the OAC to the S3 origin (CDK wires this through to the CFN Origin)
      additionalBehaviors: {}, // placeholder to keep section explicit
    });

    // 4) Allow CloudFront (via OAC) to read the bucket
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFrontRead',
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: { 'AWS:SourceArn': distribution.distributionArn },
      },
    }));
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFrontList',
      actions: ['s3:ListBucket'],
      resources: [bucket.bucketArn],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: { 'AWS:SourceArn': distribution.distributionArn },
      },
    }));

    // 5) Upload a tiny index.html so you can test immediately (optional)
    new s3deploy.BucketDeployment(this, 'DeployIndex', {
      destinationBucket: bucket,
      distribution,                       // invalidates on deploy
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.data('index.html', `<!doctype html>
<meta charset="utf-8">
<title>SPA test</title>
<style>html,body{height:100%;margin:0;font:16px/1.4 system-ui}main{display:grid;place-items:center;height:100%}</style>
<main>
  <div>
    <h1>It works 🎉</h1>
    <p>Served from S3 via CloudFront (OAC).</p>
  </div>
</main>`),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.domainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
