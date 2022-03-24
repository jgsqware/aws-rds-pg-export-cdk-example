"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB = void 0;
const pg_1 = require("pg");
const AWS = __importStar(require("aws-sdk"));
AWS.config.update({ region: process.env.AWS_REGION });
var client = new AWS.SecretsManager({
    region: process.env.AWS_REGION
});
class DB {
    static client() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!DB.instance) {
                    if (!process.env.RDS_SECRET_NAME) {
                        throw new Error("RDS_SECRET_NAME is not set");
                    }
                    if (!process.env.PROXY_ENDPOINT) {
                        throw new Error("PROXY_ENDPOINT is not set");
                    }
                    const secret = yield client.getSecretValue({ SecretId: process.env.RDS_SECRET_NAME }).promise();
                    if (!secret.SecretString) {
                        throw new Error(`SecretString of secret ${process.env.RDS_SECRET_NAME} is not set`);
                    }
                    const { username, password, dbname } = JSON.parse(secret.SecretString);
                    DB.instance = new pg_1.Client({
                        host: process.env.PROXY_ENDPOINT,
                        port: 5432,
                        ssl: true,
                        user: username,
                        database: dbname,
                        password: password
                    });
                    yield DB.instance.connect();
                }
                return DB.instance;
            }
            catch (err) {
                throw new Error(`Failed to connect to database: ${JSON.stringify(err)}`);
            }
        });
    }
}
exports.DB = DB;
