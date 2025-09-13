import { DeployEnvEnum } from "./types";

export const DEPLOYMENT_ENV_CONFIG = {
    frontend: {
        owner: "nd-chung",
        repo: "learn-aws-cicd-frontend-vue",
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
