import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "../src/db";

async function main(){
  const source=readFileSync(resolve(process.cwd(),"src/server.ts"),"utf8");
  const routeStart=source.indexOf('app.get("/api/reports/branches/trading"');
  const queryStart=source.indexOf("`WITH dimensions AS (",routeStart);
  const queryEnd=source.indexOf("`,[req.auth!.companyId,parsed.data.from??null,parsed.data.to??null])",queryStart);
  if(routeStart<0||queryStart<0||queryEnd<0)throw new Error("Could not locate the branch trading report query in server.ts.");
  const sql=source.slice(queryStart+1,queryEnd);
  const company=await pool.query<{id:string}>("SELECT id FROM companies ORDER BY id LIMIT 1");
  if(!company.rowCount)throw new Error("No company is configured in the local database.");
  const result=await pool.query(sql,[company.rows[0].id,null,null]);
  console.log(JSON.stringify({query:"branch-trading-report",executed:true,branchRows:result.rowCount}));
}

main().catch(error=>{console.error(error instanceof Error?error.message:"Branch report query failed.");process.exitCode=1}).finally(()=>pool.end());
