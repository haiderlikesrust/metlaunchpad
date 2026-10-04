import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";

function key(value:string){const bytes=Buffer.from(value,"base64");if(bytes.length!==32)throw new Error("AGENT_WALLET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");return bytes;}
/** Bind ciphertext to its record so copying an encrypted key cannot reassign custody. */
export function seal(value:string,context:string,secret:string){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret),iv);cipher.setAAD(Buffer.from(context));
 const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),encrypted.toString("base64")].join(".");
}
export function unseal(value:string,context:string,secret:string){
 const [version,iv,tag,data,...extra]=value.split(".");if(version!=="v1"||extra.length||!iv||!tag||!data)throw new Error("Invalid custody envelope.");
 const decipher=createDecipheriv("aes-256-gcm",key(secret),Buffer.from(iv,"base64"));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(tag,"base64"));
 return Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8");
}
