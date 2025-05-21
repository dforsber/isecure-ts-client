#!/bin/bash

aws cognito-idp admin-delete-user --user-pool-id eu-west-1_QtCfMyN6J --username e_dforsber+test102_at_gmail.com__admin || true
aws cognito-idp admin-delete-user --user-pool-id eu-west-1_QtCfMyN6J --username e_dforsber+test102_at_gmail.com__data || true
aws dynamodb delete-item --table-name isecure-ws-channel-users --key '{"email":{"S":"dforsber+test102@gmail.com"}}' || true
