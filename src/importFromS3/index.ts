import { DB } from "./database";

async function query(query: string) {
  const pgclient = await DB.client();
  console.log("Executing query: " + query);
  const result = await pgclient.query(query);
  console.log(query, "Result:", result);
  return result;
}
export const handler = async (event: any, callback: any) => {
  try {

    const queries = [
      "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE;",
      "DROP TABLE IF EXISTS sample_table",
      "CREATE TABLE sample_table (bid bigint PRIMARY KEY, name varchar(80));",
      `SELECT aws_s3.table_import_from_s3('sample_table','','(format csv)',aws_commons.create_s3_uri('${process.env["S3_BUCKET"]}', 'from_export.csv','eu-west-1');`
    ]

    for (const q of queries) {
      await query(q);
    }

    const result = await query("SELECT * FROM sample_table")
    const response = {
      'statusCode': 200,
      'body': JSON.stringify({
        message: `hello world from Import From S3`,
        result: result.rows
      })
    }
    console.log("Response:", JSON.stringify(response));
    return response;
  } catch (err) {
    console.log(err);
    return err;
  }
};