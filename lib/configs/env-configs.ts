import { DeployEnvEnum } from "./types";

export const DEPLOYMENT_ENV_CONFIG = {
    frontend: {
        owner: "ducchung2444",
        repo: "aws-cicd-spa-cdk",
        [DeployEnvEnum.PROD]: {
            branch: "master",
            recordName: "fecicd",
            apexZone: 'traveloke.io.vn',
        },
        [DeployEnvEnum.STG]: {
            branch: "stg",
            recordName: "stg-spa-cicd",
            apexZone: 'traveloke.io.vn',
        },
        [DeployEnvEnum.DEV]: {
            branch: "dev",
            recordName: "dev-spa-cicd",
            apexZone: 'traveloke.io.vn',
        },
    },
}
