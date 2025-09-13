import * as dotenv from 'dotenv';
dotenv.config();

export const ACCOUNT = process.env.ACCOUNT ?? "";
export const REGION = process.env.REGION ?? "";
export const FE_CODE_CONNECTION_ARN = process.env.FE_CODE_CONNECTION_ARN ?? "";
