import CoinPage from "@/components/coin-page";
export default async function Page({params}:{params:Promise<{ca:string}>}){const {ca}=await params;return <CoinPage mint={ca}/>;}
