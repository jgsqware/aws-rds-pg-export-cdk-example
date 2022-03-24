"use strict";
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
exports.handler = void 0;
const database_1 = require("./database");
function query(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const pgclient = yield database_1.DB.client();
        console.log("Executing query: " + query);
        const result = yield pgclient.query(query);
        console.log(query, "Result:", result);
        return result;
    });
}
const handler = (event, callback) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const queries = [
            "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE;",
            "DROP TABLE IF EXISTS sample_table",
            "CREATE TABLE sample_table (bid bigint PRIMARY KEY, name varchar(80));",
            `SELECT aws_s3.table_import_from_s3('sample_table','','(format csv)',:aws_commons.create_s3_uri('${process.env["S3_BUCKET"]}', 'from_export.csv','eu-west-1');`
        ];
        for (const q of queries) {
            yield query(q);
        }
        const result = yield query("SELECT * FROM sample_table");
        const response = {
            'statusCode': 200,
            'body': JSON.stringify({
                message: `hello world from Import From S3`,
                result: result.rows
            })
        };
        console.log("Response:", JSON.stringify(response));
        return response;
    }
    catch (err) {
        console.log(err);
        return err;
    }
});
exports.handler = handler;
