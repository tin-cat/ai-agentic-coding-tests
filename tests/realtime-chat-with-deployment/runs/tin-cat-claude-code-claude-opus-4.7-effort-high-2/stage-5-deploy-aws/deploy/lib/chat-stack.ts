import * as path from 'path';
import {
	Stack,
	StackProps,
	Duration,
	RemovalPolicy,
	CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';

// The application listens here inside the container.
const CONTAINER_PORT = 3000;

// Where the chat app's repo root lives, relative to this file. The Docker image
// is built from there (Dockerfile + server.js + public/).
const APP_ROOT = path.join(__dirname, '..', '..');

/**
 * One stack that stands up the whole app:
 *
 *   Browser ──HTTPS──▶ CloudFront ──HTTP──▶ ALB ──▶ Fargate task ──▶ EFS (SQLite)
 *
 * CloudFront supplies a valid HTTPS certificate on its *.cloudfront.net domain,
 * so no custom domain is required. The ALB is locked to CloudFront's IP ranges.
 * The single Fargate task mounts a durable EFS volume for the SQLite database,
 * so message history survives task restarts and redeploys.
 */
export class ChatStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		// --- Optional app configuration (passed through to the container) -------
		// Read from CDK context (the deploy script forwards matching env vars).
		const envConfig: Record<string, string> = {};
		const passthrough: [string, string][] = [
			['bannedWords', 'BANNED_WORDS'],
			['allowedOrigins', 'ALLOWED_ORIGINS'],
			['maxMessageLength', 'MAX_MESSAGE_LENGTH'],
			['rateLimitMax', 'RATE_LIMIT_MAX'],
			['rateLimitWindowMs', 'RATE_LIMIT_WINDOW_MS'],
		];
		for (const [ctxKey, envKey] of passthrough) {
			const value = this.node.tryGetContext(ctxKey);
			if (value !== undefined && value !== null && `${value}`.length > 0) {
				envConfig[envKey] = `${value}`;
			}
		}

		// CloudFront's managed prefix list (looked up by the deploy script) so the
		// ALB only accepts traffic from CloudFront, never directly from the public.
		const cloudfrontPrefixListId: string | undefined =
			this.node.tryGetContext('cloudfrontPrefixListId');

		// --- Network ------------------------------------------------------------
		// Public subnets only, no NAT gateway: tasks get public IPs (used solely
		// for outbound image/secret pulls) and security groups gate all inbound.
		const vpc = new ec2.Vpc(this, 'Vpc', {
			maxAzs: 2,
			natGateways: 0,
			subnetConfiguration: [
				{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
			],
		});

		const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
			vpc,
			description: 'Chat ALB: ingress from CloudFront only',
			allowAllOutbound: true,
		});
		const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
			vpc,
			description: 'Chat Fargate service',
			allowAllOutbound: true,
		});
		const efsSg = new ec2.SecurityGroup(this, 'EfsSg', {
			vpc,
			description: 'Chat EFS mount targets',
			allowAllOutbound: true,
		});

		// ALB <- CloudFront (or the whole internet if the prefix list is missing).
		if (cloudfrontPrefixListId) {
			albSg.addIngressRule(
				ec2.Peer.prefixList(cloudfrontPrefixListId),
				ec2.Port.tcp(80),
				'CloudFront origin-facing range -> ALB',
			);
		} else {
			albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public -> ALB (no prefix list)');
		}
		// Task <- ALB; EFS <- task.
		serviceSg.addIngressRule(albSg, ec2.Port.tcp(CONTAINER_PORT), 'ALB -> task');
		efsSg.addIngressRule(serviceSg, ec2.Port.tcp(2049), 'task -> EFS (NFS)');

		// --- Durable storage ----------------------------------------------------
		// RETAINed so destroying the stack never silently deletes chat history.
		const fileSystem = new efs.FileSystem(this, 'ChatData', {
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
			securityGroup: efsSg,
			encrypted: true,
			removalPolicy: RemovalPolicy.RETAIN,
			performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
			throughputMode: efs.ThroughputMode.BURSTING,
		});

		// Access point that pins ownership to a non-root uid/gid and isolates the
		// app to its own subdirectory of the file system.
		const accessPoint = fileSystem.addAccessPoint('AccessPoint', {
			path: '/chat',
			createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '750' },
			posixUser: { uid: '1000', gid: '1000' },
		});

		// --- Secrets ------------------------------------------------------------
		// The admin API token is generated in AWS and injected into the container;
		// it is never written to disk or committed. Retrieve it with the CLI
		// command printed in the stack outputs.
		const adminToken = new secretsmanager.Secret(this, 'AdminToken', {
			description: 'Bearer token for the chat app /admin API',
			generateSecretString: {
				passwordLength: 40,
				excludePunctuation: true,
				includeSpace: false,
			},
		});

		// --- Compute ------------------------------------------------------------
		const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

		const logGroup = new logs.LogGroup(this, 'Logs', {
			retention: logs.RetentionDays.ONE_MONTH,
			removalPolicy: RemovalPolicy.DESTROY,
		});

		const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
			cpu: 256,
			memoryLimitMiB: 512,
			runtimePlatform: {
				cpuArchitecture: ecs.CpuArchitecture.X86_64,
				operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
			},
			volumes: [
				{
					name: 'chat-data',
					efsVolumeConfiguration: {
						fileSystemId: fileSystem.fileSystemId,
						transitEncryption: 'ENABLED',
						authorizationConfig: { accessPointId: accessPoint.accessPointId },
					},
				},
			],
		});

		const container = taskDef.addContainer('app', {
			// Built from the repo root Dockerfile and pushed to ECR on every deploy.
			image: ecs.ContainerImage.fromAsset(APP_ROOT, {
				platform: Platform.LINUX_AMD64,
			}),
			logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'chat', logGroup }),
			environment: {
				PORT: `${CONTAINER_PORT}`,
				// SQLite database file lives on the mounted EFS volume.
				DB_PATH: '/data/chat.db',
				// EFS has no shared-memory support; EXCLUSIVE locking lets WAL work.
				SQLITE_LOCKING_MODE: 'EXCLUSIVE',
				...envConfig,
			},
			secrets: {
				ADMIN_TOKEN: ecs.Secret.fromSecretsManager(adminToken),
			},
			portMappings: [{ containerPort: CONTAINER_PORT }],
			// Give the app time to checkpoint the WAL and close the DB on SIGTERM.
			stopTimeout: Duration.seconds(20),
		});
		container.addMountPoints({
			containerPath: '/data',
			sourceVolume: 'chat-data',
			readOnly: false,
		});

		const service = new ecs.FargateService(this, 'Service', {
			cluster,
			taskDefinition: taskDef,
			desiredCount: 1,
			assignPublicIp: true,
			vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
			securityGroups: [serviceSg],
			// Stop the old task before starting the new one: SQLite is a single
			// writer, so we never want two tasks holding the EFS database at once.
			// This means a brief blip during redeploys, which is acceptable here.
			minHealthyPercent: 0,
			maxHealthyPercent: 100,
			circuitBreaker: { rollback: true },
			healthCheckGracePeriod: Duration.seconds(60),
		});

		// --- Load balancer ------------------------------------------------------
		const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
			vpc,
			internetFacing: true,
			securityGroup: albSg,
			idleTimeout: Duration.seconds(300),
		});

		// `open: false` keeps CDK from widening the SG to 0.0.0.0/0; we manage
		// ingress ourselves (CloudFront prefix list above).
		const listener = alb.addListener('Http', { port: 80, open: false });
		listener.addTargets('Ecs', {
			port: CONTAINER_PORT,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targets: [service],
			deregistrationDelay: Duration.seconds(10),
			healthCheck: {
				path: '/healthz',
				interval: Duration.seconds(15),
				timeout: Duration.seconds(5),
				healthyThresholdCount: 2,
				unhealthyThresholdCount: 3,
			},
		});

		// --- CDN / HTTPS --------------------------------------------------------
		// CloudFront terminates TLS with its default *.cloudfront.net certificate
		// (no custom domain needed) and proxies to the ALB over HTTP. Caching is
		// disabled and all viewer headers are forwarded so WebSocket upgrades and
		// the server's same-origin check work correctly.
		const distribution = new cloudfront.Distribution(this, 'Cdn', {
			comment: 'Real-time chat',
			defaultBehavior: {
				origin: new origins.LoadBalancerV2Origin(alb, {
					protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
					httpPort: 80,
					readTimeout: Duration.seconds(60),
					keepaliveTimeout: Duration.seconds(60),
				}),
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
				cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
				originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
			},
			httpVersion: cloudfront.HttpVersion.HTTP2,
		});

		// --- Outputs ------------------------------------------------------------
		new CfnOutput(this, 'PublicUrl', {
			value: `https://${distribution.distributionDomainName}`,
			description: 'Public HTTPS URL for the chat app',
		});
		new CfnOutput(this, 'AlbDnsName', {
			value: alb.loadBalancerDnsName,
			description: 'Internal ALB DNS (origin only; not for direct use)',
		});
		new CfnOutput(this, 'EfsFileSystemId', {
			value: fileSystem.fileSystemId,
			description: 'EFS file system holding the SQLite database (retained on stack deletion)',
		});
		new CfnOutput(this, 'AdminTokenSecretArn', {
			value: adminToken.secretArn,
			description: 'Secrets Manager ARN of the admin API token',
		});
		new CfnOutput(this, 'GetAdminTokenCommand', {
			value: `aws secretsmanager get-secret-value --secret-id ${adminToken.secretArn} --query SecretString --output text`,
			description: 'Run this to print the admin API token',
		});
	}
}
