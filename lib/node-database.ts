import {DatabaseSync,type SQLInputValue} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";

let connection:DatabaseSync|undefined;
function sqlite(){
 if(!connection){
  const path=resolve(process.env.DATABASE_PATH||".data/thicc.sqlite");
  mkdirSync(dirname(path),{recursive:true});
  connection=new DatabaseSync(path);
  connection.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
 }
 return connection;
}
class Statement{
 constructor(readonly sql:string,readonly args:SQLInputValue[]=[]){ }
 bind(...args:SQLInputValue[]){return new Statement(this.sql,args);}
 async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{const row=sqlite().prepare(this.sql).get(...this.args);return (row?(column?row[column]:row):null) as T|null;}
 async all<T=Record<string,unknown>>(){return {results:sqlite().prepare(this.sql).all(...this.args) as T[],success:true,meta:{}};}
 async run(){const result=sqlite().prepare(this.sql).run(...this.args);return {results:[],success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 async raw(){const rows=sqlite().prepare(this.sql).all(...this.args);return rows.map(row=>Object.values(row));}
}
/** D1-shaped adapter for the existing parameterized SQL repository. One web
 * process owns a persistent SQLite file; the scheduler calls HTTP, not SQLite.
 */
export const nodeDatabase={
 prepare(sql:string){return new Statement(sql);},
 async batch(statements:Statement[]){
  const db=sqlite();db.exec("BEGIN IMMEDIATE");
  try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec("COMMIT");return results;}
  catch(error){db.exec("ROLLBACK");throw error;}
 },
 async exec(sql:string){sqlite().exec(sql);return {count:1,duration:0};},
};
