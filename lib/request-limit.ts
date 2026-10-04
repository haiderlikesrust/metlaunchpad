import {HttpError} from "./server";
export async function boundedRequest(request:Request,limit:number){
 if(!request.body)return request;const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,"Request too large.");}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new Request(request.url,{method:request.method,headers:request.headers,body:bytes});
}
