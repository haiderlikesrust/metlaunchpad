import Dashboard from "@/components/dashboard";
import {dashboardView} from "@/lib/navigation";
export default async function Home({searchParams}:{searchParams:Promise<{view?:string|string[]}>}){
 const query=await searchParams;
 return <Dashboard initialView={dashboardView(query.view)}/>;
}
