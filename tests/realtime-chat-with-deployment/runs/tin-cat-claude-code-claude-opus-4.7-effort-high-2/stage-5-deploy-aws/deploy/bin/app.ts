#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ChatStack } from '../lib/chat-stack';

const app = new cdk.App();

// The stack is environment-agnostic: it deploys to whatever account/region the
// active AWS credentials and CLI point at, and selects availability zones at
// deploy time (Fn::GetAZs) rather than looking them up at synth. This keeps the
// deploy from needing extra read permissions and works in any region.
new ChatStack(app, 'RealtimeChatStack', {
	description: 'Real-time chat: Fargate + EFS behind an ALB and CloudFront HTTPS.',
});
