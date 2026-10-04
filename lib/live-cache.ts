/** Share reads across viewers without overlapping requests or caching errors. */
export function liveCache<T>(ttl:number,max=256){
 const values=new Map<string,{at:number;value:T}>(),pending=new Map<string,Promise<T>>();
 return (key:string,read:()=>Promise<T>):Promise<T>=>{
  const cached=values.get(key);if(cached&&Date.now()-cached.at<ttl)return Promise.resolve(cached.value);
  const active=pending.get(key);if(active)return active;
  const request=read().then(value=>{values.set(key,{at:Date.now(),value});if(values.size>max)values.delete(values.keys().next().value!);return value;}).finally(()=>pending.delete(key));pending.set(key,request);return request;
 };
}
