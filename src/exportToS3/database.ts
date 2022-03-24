import { Client as PG_Client } from "pg";
import * as AWS from "aws-sdk";


AWS.config.update({ region: process.env.AWS_REGION });
var client = new AWS.SecretsManager({
    region: process.env.AWS_REGION
});

export class DB {
    private static instance: PG_Client;

    static async client(): Promise<PG_Client> {

        try {
            if (!DB.instance) {
                if (!process.env.RDS_SECRET_NAME) {
                    throw new Error("RDS_SECRET_NAME is not set");
                }
                if (!process.env.PROXY_ENDPOINT) {
                    throw new Error("PROXY_ENDPOINT is not set");
                }

                const secret = await client.getSecretValue({ SecretId: process.env.RDS_SECRET_NAME }).promise();
                if (!secret.SecretString) {
                    throw new Error(`SecretString of secret ${process.env.RDS_SECRET_NAME} is not set`);
                }
                const { username, password, dbname } = JSON.parse(secret.SecretString);
                DB.instance = new PG_Client({
                    host: process.env.PROXY_ENDPOINT,
                    port: 5432,
                    ssl: true,
                    user: username,
                    database: dbname,
                    password: password
                });
                await DB.instance.connect();
            }

            return DB.instance;
        } catch (err) {
            throw new Error(`Failed to connect to database: ${JSON.stringify(err)}`)
        }
    }
}