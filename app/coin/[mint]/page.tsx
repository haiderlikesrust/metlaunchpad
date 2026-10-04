import {redirect} from "next/navigation";
export default async function Page({params}:{params:Promise<{mint:string}>}){const {mint}=await params;redirect(`/token/${mint}`);}
